# frozen_string_literal: true

require_relative 'support'

class PolicyTest < OfflineTest
  def policy
    NamespaceSecrets::SecretPolicy.new(Fixtures.identity)
  end

  def test_generated_runtime_values_match_exact_policy_and_are_independent
    5.times do
      binding = policy.fresh_binding
      document = policy.build(Fixtures::RUNTIME, binding)
      equal(document, policy.validate(Fixtures::RUNTIME, document))
      values = document.fetch('data').values.map { |value| Base64.strict_decode64(value) }
      equal(6, values.uniq.length)
      assert(document['immutable'])
      assert(!document['metadata'].key?('ownerReferences'))
    end
  end

  def test_owner_password_matches_canonical_bootstrap_rules
    owner = policy.build(Fixtures::OWNER, Fixtures::BINDING)
    password = Base64.strict_decode64(owner.fetch('data').fetch('OWNER_PASSWORD'))
    assert(password.length >= 16 && password.match?(/[a-z]/) && password.match?(/[A-Z]/))
    assert(password.match?(/[0-9]/) && password.match?(/[^A-Za-z0-9\s]/) && !password.include?("\n"))
    equal(owner, policy.validate(Fixtures::OWNER, owner))
    equal(%w[OWNER_EMAIL OWNER_EMAIL_VERIFIED OWNER_PASSWORD], owner.fetch('data').keys.sort)
  end

  def test_input_identity_is_required_and_foreign_keys_or_unverified_email_are_refused
    [{}, Fixtures.identity_values.merge('OWNER_EMAIL_VERIFIED' => 'false'),
     Fixtures.identity_values.merge('OWNER_EMAIL' => 'invalid'),
     Fixtures.identity_values.merge('OWNER_PASSWORD' => 'not-an-input'),
     Fixtures.identity_values.merge('OWNER_EMAIL_VERIFIED' => "true\n"),
     Fixtures.identity_values.merge('OWNER_NAME' => "control\u0000")].each do |values|
      refuses { NamespaceSecrets::OwnerIdentity.new(values) }
    end
  end

  def test_identity_normalization_matches_bootstrap_without_inventing_an_optional_name
    values = Fixtures.identity_values.merge('OWNER_EMAIL' => "  #{Fixtures.identity_values.fetch('OWNER_EMAIL').upcase}  ")
    identity = NamespaceSecrets::OwnerIdentity.new(values)
    equal(Fixtures.identity_values, identity.values)
    named = NamespaceSecrets::OwnerIdentity.new(values.merge('OWNER_NAME' => '  Offline Owner  '))
    equal('Offline Owner', named.values.fetch('OWNER_NAME'))
    assert(!identity.values.key?('OWNER_NAME'))
  end

  def test_identity_snapshot_reads_one_projected_revision_with_bounded_files
    volume = MemoryIdentityVolume.new(Fixtures.identity_values.transform_values { |value| value + "\n" })
    identity = NamespaceSecrets::OwnerIdentity.from_volume(files: volume, dirs: volume)
    equal(Fixtures.identity_values, identity.values)
    equal(1, volume.resolutions)
    assert(volume.reads.all? { |path, limit| path.start_with?(MemoryIdentityVolume::REVISION + '/') && limit == 1025 })
  end

  def test_missing_or_oversized_identity_file_is_refused
    [Fixtures.identity_values.reject { |key, _| key == 'OWNER_EMAIL' },
     Fixtures.identity_values.merge('OWNER_NAME' => 'x' * 1025),
     Fixtures.identity_values.merge('FOREIGN_INPUT' => 'ignored-is-not-allowed')].each do |values|
      volume = MemoryIdentityVolume.new(values)
      refuses { NamespaceSecrets::OwnerIdentity.from_volume(files: volume, dirs: volume) }
    end
  end

  def test_unknown_runtime_key_missing_key_and_noncanonical_base64_are_refused
    changes = [->(document) { document['data']['FOREIGN'] = Base64.strict_encode64('offline') },
               ->(document) { document['data'].delete('REDIS_PASSWORD') },
               ->(document) { document['data']['REDIS_PASSWORD'] += "\n" },
               ->(document) { document['data']['REDIS_PASSWORD'] = document['data']['POSTGRES_PASSWORD'] },
               ->(document) { document['data']['SECRET_KEY_BASE'] = Base64.strict_encode64('short') }]
    changes.each do |change|
      document = Fixtures.secret(Fixtures::RUNTIME)
      change.call(document)
      refuses { policy.validate(Fixtures::RUNTIME, document) }
    end
  end

  def test_foreign_ownership_mutable_deleting_or_wrong_namespace_objects_are_refused
    changes = [->(document) { document['metadata']['labels'].clear },
               ->(document) { document['metadata']['namespace'] = 'erp' },
               ->(document) { document['metadata']['annotations']['hupo.chat/install-binding'] = 'invalid' },
               ->(document) { document['metadata']['annotations'].delete('argocd.argoproj.io/sync-options') },
               ->(document) { document['metadata']['ownerReferences'] = [{ 'kind' => 'Job' }] },
               ->(document) { document['metadata']['deletionTimestamp'] = 'offline' },
               ->(document) { document['immutable'] = false },
               ->(document) { document['type'] = 'kubernetes.io/service-account-token' },
               ->(document) { document['stringData'] = {} }]
    changes.each do |change|
      document = Fixtures.secret(Fixtures::RUNTIME)
      change.call(document)
      refuses { policy.validate(Fixtures::RUNTIME, document) }
    end
  end

  def test_existing_owner_must_match_read_only_input_identity_exactly
    %w[OWNER_EMAIL OWNER_EMAIL_VERIFIED OWNER_NAME OWNER_PASSWORD].each do |key|
      owner = Fixtures.secret(Fixtures::OWNER)
      owner['data'][key] = Base64.strict_encode64('invalid')
      refuses { policy.validate(Fixtures::OWNER, owner) }
    end
  end

  def test_valid_secrets_with_different_install_bindings_are_not_a_pair
    runtime = Fixtures.secret(Fixtures::RUNTIME)
    owner = Fixtures.secret(Fixtures::OWNER, binding: Digest::SHA256.hexdigest('other-install'))
    refuses { policy.validate_pair(runtime, owner) }
  end
end

class MemoryIdentityVolume
  ROOT = '/run/hupo-chat-owner-identity'
  REVISION = ROOT + '/..offline-revision'
  attr_reader :reads, :resolutions

  def initialize(values)
    @values = values
    @reads = []
    @resolutions = 0
  end

  def realpath(path)
    return ROOT if path == '/var/run/hupo-chat-owner-identity'

    raise 'wrong identity root' unless path == ROOT + '/..data'

    @resolutions += 1
    REVISION
  end

  def children(path)
    raise 'not a pinned revision' unless path == REVISION

    @values.keys
  end

  def binread(path, limit)
    @reads << [path, limit]
    @values.fetch(path.split('/').last).byteslice(0, limit)
  end
end
