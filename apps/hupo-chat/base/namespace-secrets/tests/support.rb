# frozen_string_literal: true

require 'json'
require 'base64'
require 'digest'
require 'stringio'
require_relative '../generate'

class OfflineTest
  def assert(value)
    raise 'assertion failed' unless value
  end

  def equal(expected, actual)
    assert(expected == actual)
  end

  def refuses
    raised = false
    begin
      yield
    rescue NamespaceSecrets::Refusal
      raised = true
    end
    assert(raised)
  end
end

module Fixtures
  RUNTIME = 'hupo-chat-secrets'
  OWNER = 'hupo-chat-owner-bootstrap'
  NAMESPACE = 'hupo-chat'
  PREFIX = '/api/v1/namespaces/hupo-chat'
  BINDING = Digest::SHA256.hexdigest('offline-installation')

  def self.identity_values
    { 'OWNER_EMAIL' => ['owner', 'example.invalid'].join('@'), 'OWNER_EMAIL_VERIFIED' => 'true' }
  end

  def self.identity
    NamespaceSecrets::OwnerIdentity.new(identity_values)
  end

  def self.runtime_values
    lengths = { 'POSTGRES_PASSWORD' => 48, 'REDIS_PASSWORD' => 48, 'SECRET_KEY_BASE' => 128,
                'ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY' => 32,
                'ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY' => 32,
                'ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT' => 32 }
    lengths.to_h { |key, length| [key, (Digest::SHA256.hexdigest(key) * 2)[0, length]] }
  end

  def self.secret(name, binding: BINDING)
    values = name == RUNTIME ? runtime_values : identity_values.merge('OWNER_PASSWORD' => Digest::SHA256.hexdigest('offline-password') + 'aA0!')
    { 'apiVersion' => 'v1', 'kind' => 'Secret', 'type' => 'Opaque', 'immutable' => true,
      'metadata' => { 'name' => name, 'namespace' => NAMESPACE, 'uid' => "offline-#{name}",
                      'resourceVersion' => '1',
                      'labels' => { 'app.kubernetes.io/managed-by' => 'hupo-chat-namespace-secrets',
                                    'app.kubernetes.io/part-of' => NAMESPACE },
                      'annotations' => { 'hupo.chat/secret-schema' => 'namespace-secrets-v1',
                                         'hupo.chat/install-binding' => binding,
                                         'argocd.argoproj.io/sync-options' => 'Prune=false,Delete=false' } },
      'data' => values.transform_values { |value| Base64.strict_encode64(value) } }
  end

  def self.copy(value)
    JSON.parse(JSON.generate(value))
  end

  def self.status(code, name, resource = 'secrets')
    { 'apiVersion' => 'v1', 'kind' => 'Status', 'status' => 'Failure', 'code' => code,
      'reason' => code == 404 ? 'NotFound' : 'AlreadyExists',
      'details' => { 'name' => name, 'kind' => resource } }
  end

  def self.result(code, object)
    NamespaceSecrets::HttpResult.new(code: code, body: JSON.generate(object))
  end
end

class NoEntropy
  attr_reader :calls

  def initialize
    @calls = 0
  end

  def hex(*)
    @calls += 1
    raise 'entropy must not be accessed'
  end
end

class CountingEntropy
  attr_reader :calls

  def initialize
    @calls = []
  end

  def hex(bytes)
    @calls << bytes
    SecureRandom.hex(bytes)
  end
end

class MemoryTransport
  attr_reader :objects, :calls, :posts

  def initialize(*documents)
    @objects = documents.to_h { |document| [document.dig('metadata', 'name'), Fixtures.copy(document)] }
    @calls = []
    @posts = []
    @queued = Hash.new { |hash, key| hash[key] = [] }
  end

  def queue(method, path, &result)
    @queued[[method, path]] << result
  end

  def request(method, path, body = nil)
    @calls << [method, path]
    @posts << Fixtures.copy(JSON.parse(body)) if method == 'POST'
    queued = @queued[[method, path]].shift
    return queued.call(self) if queued

    name = path.split('/').last
    resource = path.include?('/persistentvolumeclaims/') ? 'persistentvolumeclaims' : 'secrets'
    if method == 'GET'
      return Fixtures.result(200, @objects.fetch(name)) if @objects.key?(name)

      return Fixtures.result(404, Fixtures.status(404, name, resource))
    end
    document = JSON.parse(body)
    name = document.fetch('metadata').fetch('name')
    return Fixtures.result(409, Fixtures.status(409, name)) if @objects.key?(name)

    document['metadata']['uid'] = "offline-#{name}"
    document['metadata']['resourceVersion'] = '1'
    @objects[name] = document
    Fixtures.result(201, document)
  end
end

module GeneratorFixture
  def generator(transport, entropy: SecureRandom)
    NamespaceSecrets::Generator.new(api: NamespaceSecrets::KubernetesApi.new(transport: transport),
                                    policy: NamespaceSecrets::SecretPolicy.new(Fixtures.identity, entropy: entropy),
                                    pause: -> {})
  end
end
