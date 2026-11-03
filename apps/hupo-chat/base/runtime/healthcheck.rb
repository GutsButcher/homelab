# frozen_string_literal: true

require 'net/http'
require 'json'

begin
  port = Integer(ARGV.fetch(0, '3000'))
  path = ARGV.fetch(1, '/health')
  # Do not route local health checks through HTTP_PROXY.
  http = Net::HTTP.new('127.0.0.1', port, nil)
  http.open_timeout = 2
  http.read_timeout = 2
  response = http.get(path)
  raise 'HTTP health failed' unless response.code == '200'

  if path == '/api'
    payload = JSON.parse(response.body)
    raise 'dependencies are not healthy' unless payload['data_services'] == 'ok' && payload['queue_services'] == 'ok'
  end
rescue StandardError
  exit(1)
end
