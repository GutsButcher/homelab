# frozen_string_literal: true

require_relative 'support'

class ApiTest < OfflineTest
  def test_only_well_formed_named_not_found_is_absent
    transport = MemoryTransport.new
    api = NamespaceSecrets::KubernetesApi.new(transport: transport)
    equal(nil, api.get_secret(Fixtures::RUNTIME))
    NamespaceSecrets::KubernetesApi::PVC_NAMES.each { |name| equal(nil, api.get_pvc(name)) }
  end

  def test_named_secret_not_found_rejects_floating_status_code
    NamespaceSecrets::KubernetesApi::SECRET_NAMES.each do |name|
      transport = MemoryTransport.new
      status = Fixtures.status(404, name)
      status['code'] = 404.0
      transport.queue('GET', Fixtures::PREFIX + '/secrets/' + name) { Fixtures.result(404, status) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_secret(name) }
    end
  end

  def test_named_pvc_not_found_rejects_floating_status_code
    NamespaceSecrets::KubernetesApi::PVC_NAMES.each do |name|
      transport = MemoryTransport.new
      status = Fixtures.status(404, name, 'persistentvolumeclaims')
      status['code'] = 404.0
      transport.queue('GET', Fixtures::PREFIX + '/persistentvolumeclaims/' + name) { Fixtures.result(404, status) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_pvc(name) }
    end
  end

  def test_status_failures_redirects_and_wrong_named_404_are_not_absence
    [401, 403, 429, 500, 503, 301, 302, 307, 204].each do |code|
      transport = MemoryTransport.new
      transport.queue('GET', secret_path) { Fixtures.result(code, {}) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_secret(Fixtures::RUNTIME) }
    end
    [Fixtures.status(404, Fixtures::OWNER), {}, [], Fixtures.secret(Fixtures::RUNTIME)].each do |object|
      transport = MemoryTransport.new
      transport.queue('GET', secret_path) { Fixtures.result(404, object) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_secret(Fixtures::RUNTIME) }
    end
  end

  def test_malformed_oversized_duplicate_or_trailing_json_is_refused
    ['{', '{"kind":"Secret","kind":"Status"}', '{}{}', '[]', 'x' * 65_537].each do |body|
      transport = MemoryTransport.new
      transport.queue('GET', secret_path) { NamespaceSecrets::HttpResult.new(code: 200, body: body) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_secret(Fixtures::RUNTIME) }
    end
  end

  def test_wrong_resource_name_namespace_or_kind_is_refused
    changes = [->(document) { document['metadata']['name'] = Fixtures::OWNER },
               ->(document) { document['metadata']['namespace'] = 'default' },
               ->(document) { document['kind'] = 'ConfigMap' }]
    changes.each do |change|
      document = Fixtures.secret(Fixtures::RUNTIME)
      change.call(document)
      transport = MemoryTransport.new
      transport.queue('GET', secret_path) { Fixtures.result(200, document) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_secret(Fixtures::RUNTIME) }
    end
  end

  def test_required_server_object_metadata_cannot_be_missing_or_malformed
    ['uid', 'resourceVersion'].each do |key|
      [nil, '', [], "invalid\n"].each do |value|
        document = Fixtures.secret(Fixtures::RUNTIME)
        document['metadata'][key] = value
        transport = MemoryTransport.new
        transport.queue('GET', secret_path) { Fixtures.result(200, document) }
        refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).get_secret(Fixtures::RUNTIME) }
      end
    end
  end

  def test_all_caller_urls_path_traversal_unknown_names_and_wrong_methods_are_refused
    transport = MemoryTransport.new
    api = NamespaceSecrets::KubernetesApi.new(transport: transport)
    ['https://example.invalid/secret', '../erp', 'hupo-chat-owner-identity', 'unknown', 'hupo-chat-secrets?watch=1'].each do |name|
      refuses { api.get_secret(name) }
      refuses { api.get_pvc(name) }
    end
    document = Fixtures.secret(Fixtures::RUNTIME)
    document['metadata']['namespace'] = 'erp'
    refuses { api.create_secret(document) }
    equal([], transport.calls)
    wire = NamespaceSecrets::TlsTransport.new(read_token: -> { raise 'must not read token' })
    refuses { wire.request('GET', 'https://example.invalid/') }
    refuses { wire.request('DELETE', secret_path) }
    refuses { wire.request('GET', Fixtures::PREFIX + '/secrets') }
    refuses { wire.request('POST', secret_path, '{}') }
  end

  def test_only_created_or_valid_already_exists_are_accepted_on_post
    transport = MemoryTransport.new
    api = NamespaceSecrets::KubernetesApi.new(transport: transport)
    equal(:created, api.create_secret(Fixtures.secret(Fixtures::RUNTIME)))
    equal(:conflict, api.create_secret(Fixtures.secret(Fixtures::RUNTIME)))
    [200, 202, 403, 500, 302].each do |code|
      memory = MemoryTransport.new
      memory.queue('POST', Fixtures::PREFIX + '/secrets') { Fixtures.result(code, {}) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: memory).create_secret(Fixtures.secret(Fixtures::RUNTIME)) }
    end
    memory = MemoryTransport.new
    memory.queue('POST', Fixtures::PREFIX + '/secrets') { Fixtures.result(409, Fixtures.status(409, Fixtures::OWNER)) }
    refuses { NamespaceSecrets::KubernetesApi.new(transport: memory).create_secret(Fixtures.secret(Fixtures::RUNTIME)) }
  end

  def test_create_conflict_rejects_floating_status_code
    NamespaceSecrets::KubernetesApi::SECRET_NAMES.each do |name|
      transport = MemoryTransport.new
      status = Fixtures.status(409, name)
      status['code'] = 409.0
      transport.queue('POST', Fixtures::PREFIX + '/secrets') { Fixtures.result(409, status) }
      refuses { NamespaceSecrets::KubernetesApi.new(transport: transport).create_secret(Fixtures.secret(name)) }
    end
  end

  def test_tls_hostname_verification_ca_proxy_disable_and_timeouts_are_explicit
    http = MemoryHttp.new
    arguments = nil
    factory = ->(*values) { arguments = values; http }
    wire = NamespaceSecrets::TlsTransport.new(read_token: -> { offline_token }, http_factory: factory)
    wire.request('GET', secret_path)
    equal(['kubernetes.default.svc.cluster.local', 443, nil], arguments)
    equal(true, http.settings.fetch(:use_ssl))
    equal(OpenSSL::SSL::VERIFY_PEER, http.settings.fetch(:verify_mode))
    equal(true, http.settings.fetch(:verify_hostname))
    equal('/var/run/hupo-chat-api/ca.crt', http.settings.fetch(:ca_file))
    equal(OpenSSL::SSL::TLS1_2_VERSION, http.settings.fetch(:min_version))
    equal(2, http.settings.fetch(:open_timeout))
    equal(3, http.settings.fetch(:read_timeout))
    equal(3, http.settings.fetch(:write_timeout))
    equal(0, http.settings.fetch(:max_retries))
    equal('identity', http.last_request['Accept-Encoding'])
    equal('Bearer ' + offline_token, http.last_request['Authorization'])
  end

  def test_streamed_response_bounds_non_json_compression_and_invalid_token_fail_closed
    [MemoryHttp.new(chunks: ['x' * 40_000, 'x' * 40_000]),
     MemoryHttp.new(headers: { 'content-type' => 'text/html' }),
     MemoryHttp.new(headers: { 'content-type' => 'application/json', 'content-encoding' => 'gzip' })].each do |http|
      wire = NamespaceSecrets::TlsTransport.new(read_token: -> { offline_token }, http_factory: ->(*) { http })
      refuses { wire.request('GET', secret_path) }
    end
    ["#{offline_token}\r\nInjected: x", 'x' * 8193, 'not-a-jwt'].each do |token|
      wire = NamespaceSecrets::TlsTransport.new(read_token: -> { token }, http_factory: ->(*) { raise 'no request allowed' })
      refuses { wire.request('GET', secret_path) }
    end
  end

  def test_transport_timeout_and_certificate_failure_are_sanitized
    [Timeout::Error.new('offline raw body'), OpenSSL::SSL::SSLError.new('offline raw header')].each do |exception|
      http = MemoryHttp.new(failure: exception)
      wire = NamespaceSecrets::TlsTransport.new(read_token: -> { offline_token }, http_factory: ->(*) { http })
      refuses { wire.request('GET', secret_path) }
    end
  end

  private

  def secret_path
    Fixtures::PREFIX + '/secrets/' + Fixtures::RUNTIME
  end

  def offline_token
    %w[offline header signature].map { |part| Base64.urlsafe_encode64(part, padding: false) }.join('.')
  end
end

class MemoryHttp
  attr_reader :settings, :last_request

  def initialize(chunks: ['{}'], headers: { 'content-type' => 'application/json' }, failure: nil)
    @settings = {}
    @chunks = chunks
    @headers = headers
    @failure = failure
  end

  def method_missing(method, *arguments)
    return @settings[method.to_s.delete_suffix('=').to_sym] = arguments.first if method.to_s.end_with?('=')

    super
  end

  def respond_to_missing?(method, include_private = false)
    method.to_s.end_with?('=') || super
  end

  def start
    raise @failure if @failure

    yield self
  end

  def request(request)
    @last_request = request
    yield self
  end

  def code
    '200'
  end

  def [](name)
    @headers[name.downcase]
  end

  def read_body
    @chunks.each { |chunk| yield chunk }
  end
end
