# frozen_string_literal: true

# No gems, sockets, subprocesses, cluster, credentials or fixture-file writes.
require_relative 'generator_test'
require_relative 'policy_test'
require_relative 'api_test'

count = 0
failures = 0
ObjectSpace.each_object(Class).select { |type| type < OfflineTest }.sort_by(&:name).each do |type|
  type.instance_methods(false).grep(/^test_/).sort.each do |method|
    count += 1
    begin
      type.new.public_send(method)
      $stdout.write("PASS #{type.name}##{method}\n")
    rescue StandardError
      failures += 1
      # Exceptions can contain API payloads; do not print messages or inspect values.
      $stdout.write("FAIL #{type.name}##{method}\n")
    end
  end
end
$stdout.write("#{count} tests, #{failures} failures\n")
exit(count.positive? && failures.zero? ? 0 : 1)
