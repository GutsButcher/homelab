# frozen_string_literal: true

require 'json'
require 'net/http'
require 'openssl'
require 'timeout'
require_relative 'secret_policy'

module NamespaceSecrets
  MAX_BODY = 65_536
  HttpResult = Struct.new(:code, :body, keyword_init: true)

  class JsonObject < Hash
    def []=(key, value)
      raise Refusal if key?(key)

      super
    end
  end

  class StrictJson
    def self.load(raw)
      raise Refusal unless raw.is_a?(String) && raw.bytesize <= MAX_BODY

      text = raw.dup.force_encoding(Encoding::UTF_8)
      raise Refusal unless text.valid_encoding?

      value = JSON.parse(text, object_class: JsonObject, max_nesting: 16, allow_nan: false)
      raise Refusal unless value.is_a?(Hash)

      value
    rescue StandardError
      raise Refusal, 'response refused', cause: nil
    end
  end

  class KubernetesApi
    PREFIX = '/api/v1/namespaces/hupo-chat'
    SECRET_NAMES = %w[hupo-chat-secrets hupo-chat-owner-bootstrap].freeze
    PVC_NAMES = %w[data-hupo-chat-postgres-0 data-hupo-chat-redis-0 hupo-chat-uploads].freeze
    POST_PATH = "#{PREFIX}/secrets"
    GET_PATHS = (SECRET_NAMES.map { |name| "#{POST_PATH}/#{name}" } +
                 PVC_NAMES.map { |name| "#{PREFIX}/persistentvolumeclaims/#{name}" }).freeze

    def initialize(transport: TlsTransport.new)
      @transport = transport
    end

    def get_secret(name)
      raise Refusal unless SECRET_NAMES.include?(name)

      get_named('secrets', 'Secret', name)
    end

    def get_pvc(name)
      raise Refusal unless PVC_NAMES.include?(name)

      get_named('persistentvolumeclaims', 'PersistentVolumeClaim', name)
    end

    def create_secret(document)
      body = JSON.generate(document)
      self.class.authorize_request!('POST', POST_PATH, body)
      name = document.fetch('metadata').fetch('name')
      response = @transport.request('POST', POST_PATH, body)
      value = StrictJson.load(response.body)
      case response.code
      when 201
        validate_resource!(value, 'Secret', name)
        :created
      when 409
        validate_status!(value, 409, 'AlreadyExists', 'secrets', name)
        :conflict
      else
        raise Refusal
      end
    rescue StandardError
      raise Refusal, 'creation refused', cause: nil
    end

    def self.authorize_request!(method, path, body)
      return if method == 'GET' && GET_PATHS.include?(path) && body.nil?
      raise Refusal unless method == 'POST' && path == POST_PATH

      value = StrictJson.load(body)
      metadata = value.fetch('metadata')
      raise Refusal unless value['apiVersion'] == 'v1' && value['kind'] == 'Secret'
      raise Refusal unless metadata['namespace'] == 'hupo-chat' && SECRET_NAMES.include?(metadata['name'])
    rescue StandardError
      raise Refusal, 'request refused', cause: nil
    end

    private

    def get_named(resource, kind, name)
      response = @transport.request('GET', "#{PREFIX}/#{resource}/#{name}")
      value = StrictJson.load(response.body)
      case response.code
      when 200
        validate_resource!(value, kind, name)
        value
      when 404
        validate_status!(value, 404, 'NotFound', resource, name)
        nil
      else
        raise Refusal
      end
    rescue StandardError
      raise Refusal, 'read refused', cause: nil
    end

    def validate_resource!(value, kind, name)
      metadata = value.fetch('metadata')
      raise Refusal unless value['apiVersion'] == 'v1' && value['kind'] == kind
      raise Refusal unless metadata['name'] == name && metadata['namespace'] == 'hupo-chat'
      return unless kind == 'Secret'

      uid = metadata['uid']
      version = metadata['resourceVersion']
      raise Refusal unless uid.is_a?(String) && uid.match?(/\A[A-Za-z0-9-]{1,128}\z/)
      raise Refusal unless version.is_a?(String) && version.match?(/\A[0-9]{1,32}\z/)
    end

    def validate_status!(value, code, reason, resource, name)
      details = value.fetch('details')
      raise Refusal unless value['apiVersion'] == 'v1' && value['kind'] == 'Status'
      raise Refusal unless value['code'].is_a?(Integer)
      raise Refusal unless value['status'] == 'Failure' && value['code'] == code && value['reason'] == reason
      raise Refusal unless details['name'] == name && details['kind'] == resource && details.fetch('group', '') == ''
    end
  end

  class TlsTransport
    HOST = 'kubernetes.default.svc.cluster.local'
    CA_FILE = '/var/run/hupo-chat-api/ca.crt'
    TOKEN_FILE = '/var/run/hupo-chat-api/token'

    def initialize(read_token: -> { File.binread(TOKEN_FILE, 8193) },
                   http_factory: ->(host, port, proxy) { Net::HTTP.new(host, port, proxy) })
      @read_token = read_token
      @http_factory = http_factory
    end

    def request(method, path, body = nil)
      KubernetesApi.authorize_request!(method, path, body)
      token = @read_token.call
      raise Refusal unless token.is_a?(String) && token.bytesize <= 8192

      token = token.sub(/\r?\n\z/, '')
      raise Refusal unless token.match?(/\A[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\z/)

      http = configured_http
      request = method == 'GET' ? Net::HTTP::Get.new(path) : Net::HTTP::Post.new(path)
      request['Authorization'] = "Bearer #{token}"
      request['Accept'] = 'application/json'
      request['Accept-Encoding'] = 'identity'
      request['Content-Type'] = 'application/json'
      request.body = body unless body.nil?
      result = nil
      Timeout.timeout(8) do
        http.start do |connection|
          connection.request(request) { |response| result = read_response(response) }
        end
      end
      raise Refusal unless result

      result
    rescue StandardError
      raise Refusal, 'transport refused', cause: nil
    end

    private

    def configured_http
      # An explicit nil proxy disables HTTP_PROXY/HTTPS_PROXY/ALL_PROXY lookup.
      http = @http_factory.call(HOST, 443, nil)
      http.use_ssl = true
      http.verify_mode = OpenSSL::SSL::VERIFY_PEER
      http.verify_hostname = true
      http.ca_file = CA_FILE
      http.min_version = OpenSSL::SSL::TLS1_2_VERSION
      http.open_timeout = 2
      http.read_timeout = 3
      http.write_timeout = 3
      http.ssl_timeout = 3
      http.continue_timeout = 1
      http.keep_alive_timeout = 1
      http.max_retries = 0
      http
    end

    def read_response(response)
      raise Refusal unless response['content-type'].to_s.downcase.split(';', 2).first.to_s.strip == 'application/json'
      raise Refusal unless ['', 'identity'].include?(response['content-encoding'].to_s.downcase)

      length = response['content-length']
      raise Refusal if length && (!length.match?(/\A[0-9]{1,6}\z/) || length.to_i > MAX_BODY)

      body = String.new(encoding: Encoding::BINARY)
      response.read_body do |chunk|
        raise Refusal unless chunk.is_a?(String) && body.bytesize + chunk.bytesize <= MAX_BODY

        body << chunk
      end
      raise Refusal unless response.code.to_s.match?(/\A[1-5][0-9]{2}\z/)

      HttpResult.new(code: response.code.to_i, body: body)
    end
  end
end
