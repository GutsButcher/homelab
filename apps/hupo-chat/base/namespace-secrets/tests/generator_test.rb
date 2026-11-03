# frozen_string_literal: true

require_relative 'support'

class GeneratorTest < OfflineTest
  include GeneratorFixture

  def test_fresh_install_creates_exactly_two_independent_bound_secrets
    transport = MemoryTransport.new
    equal(:validated, generator(transport).run)
    equal([Fixtures::RUNTIME, Fixtures::OWNER], transport.posts.map { |post| post.dig('metadata', 'name') })
    runtime = transport.objects.fetch(Fixtures::RUNTIME)
    owner = transport.objects.fetch(Fixtures::OWNER)
    equal(runtime.dig('metadata', 'annotations', 'hupo.chat/install-binding'), owner.dig('metadata', 'annotations', 'hupo.chat/install-binding'))
    equal(6, runtime.fetch('data').values.uniq.length)
    equal(Fixtures.identity_values.fetch('OWNER_EMAIL'), Base64.strict_decode64(owner.fetch('data').fetch('OWNER_EMAIL')))
    assert(transport.calls.all? { |method, path| %w[GET POST].include?(method) && path.start_with?(Fixtures::PREFIX + '/') })
    assert(transport.calls.any? { |method, path| method == 'GET' && path.end_with?('/' + Fixtures::OWNER) })
  end

  def test_valid_existing_secrets_are_byte_exact_and_need_no_entropy_or_pvc_reads
    runtime = Fixtures.secret(Fixtures::RUNTIME)
    owner = Fixtures.secret(Fixtures::OWNER)
    transport = MemoryTransport.new(runtime, owner)
    before = Fixtures.copy(transport.objects)
    generator(transport, entropy: NoEntropy.new).run
    equal(before, transport.objects)
    equal([], transport.posts)
    assert(transport.calls.none? { |_, path| path.include?('persistentvolumeclaims') })
  end

  def test_final_read_refuses_replaced_preserved_secret_uid
    refuses_final_secret_change { |document| document['metadata']['uid'] += '-replacement' }
  end

  def test_final_read_refuses_changed_preserved_secret_data
    refuses_final_secret_change do |document|
      key = document.dig('metadata', 'name') == Fixtures::RUNTIME ? 'POSTGRES_PASSWORD' : 'OWNER_PASSWORD'
      document['data'][key] = Base64.strict_encode64(Base64.strict_decode64(document['data'].fetch(key)).reverse)
    end
  end

  def test_second_run_is_idempotent
    transport = MemoryTransport.new
    generator(transport).run
    before = Fixtures.copy(transport.objects)
    transport.posts.clear
    generator(transport, entropy: NoEntropy.new).run
    equal(before, transport.objects)
    equal([], transport.posts)
  end

  def test_any_retained_pvc_blocks_before_entropy_or_partial_write
    NamespaceSecrets::KubernetesApi::PVC_NAMES.each do |pvc|
      [[], [Fixtures.secret(Fixtures::RUNTIME)], [Fixtures.secret(Fixtures::OWNER)]].each do |survivors|
        transport = MemoryTransport.new(*survivors)
        transport.objects[pvc] = { 'apiVersion' => 'v1', 'kind' => 'PersistentVolumeClaim',
                                   'metadata' => { 'name' => pvc, 'namespace' => Fixtures::NAMESPACE } }
        entropy = NoEntropy.new
        refuses { generator(transport, entropy: entropy).run }
        equal(0, entropy.calls)
        equal([], transport.posts)
      end
    end
  end

  def test_pvc_read_errors_block_creation
    [403, 500].each do |code|
      transport = MemoryTransport.new
      pvc = NamespaceSecrets::KubernetesApi::PVC_NAMES.first
      transport.queue('GET', Fixtures::PREFIX + '/persistentvolumeclaims/' + pvc) { Fixtures.result(code, {}) }
      entropy = NoEntropy.new
      refuses { generator(transport, entropy: entropy).run }
      equal(0, entropy.calls)
      equal([], transport.posts)
    end
  end

  def test_floating_pvc_not_found_blocks_before_entropy_or_posts
    NamespaceSecrets::KubernetesApi::PVC_NAMES.each do |pvc|
      transport = MemoryTransport.new
      status = Fixtures.status(404, pvc, 'persistentvolumeclaims')
      status['code'] = 404.0
      transport.queue('GET', Fixtures::PREFIX + '/persistentvolumeclaims/' + pvc) { Fixtures.result(404, status) }
      entropy = NoEntropy.new
      refuses { generator(transport, entropy: entropy).run }
      equal(0, entropy.calls)
      equal([], transport.posts)
    end
  end

  def test_recovers_from_either_single_surviving_secret_without_changing_it
    [Fixtures::RUNTIME, Fixtures::OWNER].each do |name|
      survivor = Fixtures.secret(name)
      transport = MemoryTransport.new(survivor)
      generator(transport).run
      equal(survivor, transport.objects.fetch(name))
      equal(1, transport.posts.length)
      equal(Fixtures::BINDING, transport.posts.first.dig('metadata', 'annotations', 'hupo.chat/install-binding'))
    end
  end

  def test_crash_after_runtime_creation_is_recoverable_only_without_pvcs
    transport = MemoryTransport.new
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      post = Fixtures.copy(memory.posts.last)
      post['metadata']['uid'] = 'offline-created'
      post['metadata']['resourceVersion'] = '1'
      memory.objects[Fixtures::RUNTIME] = post
      raise IOError, 'offline transport interruption'
    end
    refuses { generator(transport).run }
    saved = Fixtures.copy(transport.objects.fetch(Fixtures::RUNTIME))
    generator(transport).run
    equal(saved, transport.objects.fetch(Fixtures::RUNTIME))
    assert(transport.objects.key?(Fixtures::OWNER))
  end

  def test_runtime_create_race_adopts_valid_winner_before_building_owner
    transport = MemoryTransport.new
    winner = Fixtures.secret(Fixtures::RUNTIME)
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      memory.objects[Fixtures::RUNTIME] = winner
      Fixtures.result(409, Fixtures.status(409, Fixtures::RUNTIME))
    end
    generator(transport).run
    equal(winner, transport.objects.fetch(Fixtures::RUNTIME))
    equal(Fixtures::BINDING, transport.objects.fetch(Fixtures::OWNER).dig('metadata', 'annotations', 'hupo.chat/install-binding'))
  end

  def test_owner_create_race_adopts_valid_winner_without_overwriting_password
    runtime = Fixtures.secret(Fixtures::RUNTIME)
    winner = Fixtures.secret(Fixtures::OWNER)
    transport = MemoryTransport.new(runtime)
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      memory.objects[Fixtures::OWNER] = winner
      Fixtures.result(409, Fixtures.status(409, Fixtures::OWNER))
    end
    generator(transport).run
    equal(winner, transport.objects.fetch(Fixtures::OWNER))
  end

  def test_race_winner_with_another_binding_is_refused
    runtime = Fixtures.secret(Fixtures::RUNTIME)
    winner = Fixtures.secret(Fixtures::OWNER, binding: Digest::SHA256.hexdigest('different-installation'))
    transport = MemoryTransport.new(runtime)
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      memory.objects[Fixtures::OWNER] = winner
      Fixtures.result(409, Fixtures.status(409, Fixtures::OWNER))
    end
    refuses { generator(transport).run }
    equal(runtime, transport.objects.fetch(Fixtures::RUNTIME))
    equal(winner, transport.objects.fetch(Fixtures::OWNER))
  end

  def test_race_readback_is_bounded_and_does_not_retry_posts
    transport = MemoryTransport.new
    transport.queue('POST', Fixtures::PREFIX + '/secrets') { Fixtures.result(409, Fixtures.status(409, Fixtures::RUNTIME)) }
    refuses { generator(transport).run }
    equal(1, transport.posts.length)
    reads = transport.calls.count { |method, path| method == 'GET' && path.end_with?('/' + Fixtures::RUNTIME) }
    equal(4, reads)
  end

  def test_retained_pvc_appearing_between_creates_stops_second_generation
    transport = MemoryTransport.new
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      document = Fixtures.copy(memory.posts.last)
      document['metadata']['uid'] = 'offline-created'
      document['metadata']['resourceVersion'] = '1'
      memory.objects[Fixtures::RUNTIME] = document
      pvc = NamespaceSecrets::KubernetesApi::PVC_NAMES.first
      memory.objects[pvc] = { 'apiVersion' => 'v1', 'kind' => 'PersistentVolumeClaim',
                              'metadata' => { 'name' => pvc, 'namespace' => Fixtures::NAMESPACE } }
      Fixtures.result(201, document)
    end
    entropy = CountingEntropy.new
    refuses { generator(transport, entropy: entropy).run }
    equal([32, 24, 24, 64, 16, 16, 16], entropy.calls)
    equal(1, transport.posts.length)
    assert(!transport.objects.key?(Fixtures::OWNER))
  end

  def test_unmanaged_or_malformed_existing_secret_prevents_all_writes
    [403, 500, 302].each do |code|
      transport = MemoryTransport.new
      transport.queue('GET', Fixtures::PREFIX + '/secrets/' + Fixtures::RUNTIME) { Fixtures.result(code, {}) }
      entropy = NoEntropy.new
      refuses { generator(transport, entropy: entropy).run }
      equal(0, entropy.calls)
      equal([], transport.posts)
    end
    foreign = Fixtures.secret(Fixtures::RUNTIME)
    foreign['metadata']['labels'] = {}
    transport = MemoryTransport.new(foreign)
    refuses { generator(transport, entropy: NoEntropy.new).run }
    equal([], transport.posts)
  end

  def test_conflict_winner_must_have_managed_metadata_and_no_foreign_keys
    transport = MemoryTransport.new
    winner = Fixtures.secret(Fixtures::RUNTIME)
    winner['data']['FOREIGN'] = Base64.strict_encode64('offline')
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      memory.objects[Fixtures::RUNTIME] = winner
      Fixtures.result(409, Fixtures.status(409, Fixtures::RUNTIME))
    end
    refuses { generator(transport).run }
    equal(1, transport.posts.length)
    assert(!transport.objects.key?(Fixtures::OWNER))
  end

  def test_conflict_readback_allows_only_bounded_named_not_found_retries
    transport = MemoryTransport.new
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      memory.objects[Fixtures::RUNTIME] = Fixtures.secret(Fixtures::RUNTIME)
      2.times do
        memory.queue('GET', Fixtures::PREFIX + '/secrets/' + Fixtures::RUNTIME) do
          Fixtures.result(404, Fixtures.status(404, Fixtures::RUNTIME))
        end
      end
      Fixtures.result(409, Fixtures.status(409, Fixtures::RUNTIME))
    end
    generator(transport).run
    equal(2, transport.posts.length)
    equal(5, transport.calls.count { |method, path| method == 'GET' && path.end_with?('/' + Fixtures::RUNTIME) })
  end

  def test_created_response_does_not_replace_exact_named_readback_validation
    transport = MemoryTransport.new
    transport.queue('POST', Fixtures::PREFIX + '/secrets') do |memory|
      submitted = Fixtures.copy(memory.posts.last)
      submitted['metadata']['uid'] = 'offline-created'
      submitted['metadata']['resourceVersion'] = '1'
      binding = submitted.dig('metadata', 'annotations', 'hupo.chat/install-binding')
      memory.objects[Fixtures::RUNTIME] = Fixtures.secret(Fixtures::RUNTIME, binding: binding)
      Fixtures.result(201, submitted)
    end
    refuses { generator(transport).run }
    equal(1, transport.posts.length)
    assert(!transport.objects.key?(Fixtures::OWNER))
  end

  def test_invalid_identity_fails_before_any_api_call
    transport = MemoryTransport.new
    factory = lambda do
      identity = NamespaceSecrets::OwnerIdentity.new(Fixtures.identity_values.merge('OWNER_EMAIL_VERIFIED' => 'false'))
      NamespaceSecrets::Generator.new(api: NamespaceSecrets::KubernetesApi.new(transport: transport),
                                      policy: NamespaceSecrets::SecretPolicy.new(identity))
    end
    out = StringIO.new
    err = StringIO.new
    equal(1, NamespaceSecrets::Command.run(arguments: ['--run-in-cluster'], out: out, err: err, factory: factory))
    equal([], transport.calls)
    equal('', out.string)
    equal("namespace secret bootstrap: refused\n", err.string)
  end

  def test_cli_requires_explicit_run_and_never_logs_raw_exceptions_or_values
    out = StringIO.new
    err = StringIO.new
    factory = -> { raise IOError, JSON.generate(Fixtures.secret(Fixtures::RUNTIME)) }
    equal(2, NamespaceSecrets::Command.run(arguments: [], out: out, err: err, factory: factory))
    equal(1, NamespaceSecrets::Command.run(arguments: ['--run-in-cluster'], out: out, err: err, factory: factory))
    equal('', out.string)
    equal("namespace secret bootstrap: explicit in-cluster flag required\nnamespace secret bootstrap: refused\n", err.string)
  end

  def test_cli_success_output_is_fixed_and_has_no_secret_material
    transport = MemoryTransport.new
    out = StringIO.new
    err = StringIO.new
    status = NamespaceSecrets::Command.run(arguments: ['--run-in-cluster'], out: out, err: err, factory: -> { generator(transport) })
    equal(0, status)
    equal("namespace secret bootstrap: validated\n", out.string)
    equal('', err.string)
  end

  private def refuses_final_secret_change
    [Fixtures::RUNTIME, Fixtures::OWNER].each do |name|
      transport = MemoryTransport.new(Fixtures.secret(Fixtures::RUNTIME), Fixtures.secret(Fixtures::OWNER))
      original = transport.objects.fetch(name)
      changed = Fixtures.copy(original)
      yield changed
      NamespaceSecrets::SecretPolicy.new(Fixtures.identity).validate(name, changed)
      path = Fixtures::PREFIX + '/secrets/' + name
      transport.queue('GET', path) { Fixtures.result(200, original) }
      transport.queue('GET', path) do |memory|
        memory.objects[name] = changed
        Fixtures.result(200, changed)
      end
      refuses { generator(transport, entropy: NoEntropy.new).run }
      equal(2, transport.calls.count { |method, target| method == 'GET' && target == path })
      equal([], transport.posts)
    end
  end
end
