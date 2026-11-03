# frozen_string_literal: true

require 'base64'
require 'securerandom'

module NamespaceSecrets
  class Refusal < StandardError; end

  class OwnerIdentity
    ROOT = '/var/run/hupo-chat-owner-identity'
    REQUIRED = %w[OWNER_EMAIL OWNER_EMAIL_VERIFIED].freeze
    ALLOWED = (REQUIRED + ['OWNER_NAME']).freeze
    attr_reader :values

    def self.from_volume(files: File, dirs: Dir)
      # Resolve /var/run symlinks before pinning one projected Secret revision.
      root = files.realpath(ROOT)
      revision = files.realpath("#{root}/..data")
      raise Refusal unless File.dirname(revision) == root && File.basename(revision).start_with?('..')

      keys = dirs.children(revision)
      raise Refusal unless (REQUIRED - keys).empty? && (keys - ALLOWED).empty?

      values = keys.to_h do |key|
        raw = files.binread("#{revision}/#{key}", 1025)
        raise Refusal if raw.bytesize > 1024

        [key, raw.force_encoding(Encoding::UTF_8).sub(/\r?\n\z/, '')]
      end
      new(values)
    rescue StandardError
      raise Refusal, 'identity refused', cause: nil
    end

    def initialize(values)
      raise Refusal unless values.is_a?(Hash) && (REQUIRED - values.keys).empty?
      raise Refusal unless (values.keys - ALLOWED).empty?
      raise Refusal unless values.values.all? { |value| valid_text?(value) }
      raise Refusal unless values['OWNER_EMAIL_VERIFIED'] == 'true'

      email = values.fetch('OWNER_EMAIL').strip.downcase
      raise Refusal unless email.bytesize <= 254 && email.ascii_only? && email.match?(/\A[^\s@]+@[^\s@]+\.[^\s@]+\z/)

      @values = { 'OWNER_EMAIL' => email, 'OWNER_EMAIL_VERIFIED' => 'true' }
      if values.key?('OWNER_NAME')
        name = values.fetch('OWNER_NAME').strip
        raise Refusal if name.empty? || name.length > 128 || name.bytesize > 512

        @values['OWNER_NAME'] = name
      end
      @values.each_value(&:freeze)
      @values.freeze
    rescue StandardError
      raise Refusal, 'identity refused', cause: nil
    end

    private

    def valid_text?(value)
      value.is_a?(String) && value.valid_encoding? && value.bytesize <= 1024 &&
        !value.match?(/[\p{Cc}\p{Cf}]/)
    end
  end

  class SecretPolicy
    NAMESPACE = 'hupo-chat'
    RUNTIME = 'hupo-chat-secrets'
    OWNER = 'hupo-chat-owner-bootstrap'
    RUNTIME_BYTES = {
      'POSTGRES_PASSWORD' => 24, 'REDIS_PASSWORD' => 24, 'SECRET_KEY_BASE' => 64,
      'ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY' => 16,
      'ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY' => 16,
      'ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT' => 16
    }.freeze
    LABELS = { 'app.kubernetes.io/managed-by' => 'hupo-chat-namespace-secrets',
               'app.kubernetes.io/part-of' => NAMESPACE }.freeze
    SCHEMA = 'namespace-secrets-v1'
    RETENTION = 'Prune=false,Delete=false'
    BINDING_KEY = 'hupo.chat/install-binding'

    def initialize(identity, entropy: SecureRandom)
      raise Refusal unless identity.is_a?(OwnerIdentity)

      @identity = identity
      @entropy = entropy
    end

    def fresh_binding
      value = @entropy.hex(32)
      raise Refusal unless valid_binding?(value)

      value
    end

    def build(name, install_binding)
      raise Refusal unless [RUNTIME, OWNER].include?(name) && valid_binding?(install_binding)

      values = name == RUNTIME ? runtime_values : owner_values
      document = {
        'apiVersion' => 'v1', 'kind' => 'Secret', 'type' => 'Opaque', 'immutable' => true,
        'metadata' => { 'name' => name, 'namespace' => NAMESPACE, 'labels' => LABELS.dup,
                        'annotations' => { 'hupo.chat/secret-schema' => SCHEMA,
                                           BINDING_KEY => install_binding,
                                           'argocd.argoproj.io/sync-options' => RETENTION } },
        'data' => values.transform_values { |value| Base64.strict_encode64(value) }
      }
      validate(name, document)
    end

    def validate(name, document)
      raise Refusal unless [RUNTIME, OWNER].include?(name) && document.is_a?(Hash)
      raise Refusal unless document.keys.sort == %w[apiVersion data immutable kind metadata type].sort
      raise Refusal unless document['apiVersion'] == 'v1' && document['kind'] == 'Secret'
      raise Refusal unless document['type'] == 'Opaque' && document['immutable'] == true

      validate_metadata(name, document.fetch('metadata'))
      values = decode_values(document.fetch('data'))
      name == RUNTIME ? validate_runtime(values) : validate_owner(values)
      document
    rescue StandardError
      raise Refusal, 'secret refused', cause: nil
    end

    def validate_pair(runtime, owner)
      validate(RUNTIME, runtime)
      validate(OWNER, owner)
      raise Refusal unless binding(runtime) == binding(owner)
      raise Refusal if decode_values(runtime.fetch('data')).values.include?(decode_values(owner.fetch('data')).fetch('OWNER_PASSWORD'))

      true
    end

    def binding(document)
      document.fetch('metadata').fetch('annotations').fetch(BINDING_KEY)
    end

    private

    def runtime_values
      # Independent entropy calls; do not derive encryption keys from passwords.
      RUNTIME_BYTES.to_h { |key, bytes| [key, @entropy.hex(bytes)] }
    end

    def owner_values
      # The suffix guarantees Rails' four character classes; 256 bits stay random.
      @identity.values.merge('OWNER_PASSWORD' => @entropy.hex(32) + 'aA0!')
    end

    def validate_metadata(name, metadata)
      raise Refusal unless metadata.is_a?(Hash) && metadata['name'] == name && metadata['namespace'] == NAMESPACE
      raise Refusal unless metadata['labels'] == LABELS && metadata['deletionTimestamp'].nil?
      raise Refusal unless metadata.fetch('ownerReferences', []) == [] && metadata.fetch('finalizers', []) == []

      annotations = metadata.fetch('annotations')
      raise Refusal unless annotations.is_a?(Hash)
      raise Refusal unless annotations.keys.sort == ['hupo.chat/secret-schema', BINDING_KEY, 'argocd.argoproj.io/sync-options'].sort
      raise Refusal unless annotations['hupo.chat/secret-schema'] == SCHEMA
      raise Refusal unless annotations['argocd.argoproj.io/sync-options'] == RETENTION
      raise Refusal unless valid_binding?(annotations[BINDING_KEY])
    end

    def decode_values(data)
      raise Refusal unless data.is_a?(Hash) && data.keys.all? { |key| key.is_a?(String) }

      data.transform_values do |encoded|
        raise Refusal unless encoded.is_a?(String) && encoded.bytesize <= 2048

        value = Base64.strict_decode64(encoded).force_encoding(Encoding::UTF_8)
        raise Refusal unless value.valid_encoding? && value.bytesize <= 1024
        raise Refusal unless Base64.strict_encode64(value) == encoded && !value.match?(/[\p{Cc}\p{Cf}]/)

        value
      end
    end

    def validate_runtime(values)
      raise Refusal unless values.keys.sort == RUNTIME_BYTES.keys.sort
      raise Refusal unless values.values.uniq.length == RUNTIME_BYTES.length

      RUNTIME_BYTES.each do |key, bytes|
        raise Refusal unless values.fetch(key).match?(/\A[0-9a-f]{#{bytes * 2}}\z/)
      end
    end

    def validate_owner(values)
      raise Refusal unless values.keys.sort == (@identity.values.keys + ['OWNER_PASSWORD']).sort
      raise Refusal unless @identity.values.all? { |key, value| values[key] == value }

      password = values.fetch('OWNER_PASSWORD')
      raise Refusal unless password.length.between?(16, 128) && password.ascii_only?
      raise Refusal unless password.match?(/[a-z]/) && password.match?(/[A-Z]/) && password.match?(/[0-9]/)
      raise Refusal unless password.match?(/[^A-Za-z0-9\s]/) && !password.match?(/\s/)
    end

    def valid_binding?(value)
      value.is_a?(String) && value.match?(/\A[0-9a-f]{64}\z/)
    end
  end
end
