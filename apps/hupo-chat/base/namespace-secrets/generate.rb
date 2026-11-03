# frozen_string_literal: true

require_relative 'secret_policy'
require_relative 'kubernetes_api'

module NamespaceSecrets
  class Generator
    def initialize(api:, policy:, pause: -> { sleep(0.1) })
      @api = api
      @policy = policy
      @pause = pause
    end

    def run
      runtime = read_secret(SecretPolicy::RUNTIME)
      owner = read_secret(SecretPolicy::OWNER)
      unless runtime && owner
        guard_no_pvcs!
        if runtime.nil?
          install_binding = owner ? @policy.binding(owner) : @policy.fresh_binding
          runtime = create_missing(SecretPolicy::RUNTIME, install_binding, owner && install_binding)
        end
        owner ||= create_missing(SecretPolicy::OWNER, @policy.binding(runtime), @policy.binding(runtime))
      end
      @policy.validate_pair(runtime, owner)
      # Verify the exact named targets, including the unchanged survivor.
      ensure_same!(runtime, read_secret(SecretPolicy::RUNTIME))
      ensure_same!(owner, read_secret(SecretPolicy::OWNER))
      :validated
    rescue StandardError
      raise Refusal, 'bootstrap refused', cause: nil
    end

    private

    def create_missing(name, install_binding, expected_binding)
      guard_no_pvcs!
      candidate = @policy.build(name, install_binding)
      guard_no_pvcs!
      disposition = @api.create_secret(candidate)
      winner = readback(name)
      raise Refusal if expected_binding && @policy.binding(winner) != expected_binding
      if disposition == :created
        raise Refusal unless winner.fetch('data') == candidate.fetch('data')
        raise Refusal unless @policy.binding(winner) == @policy.binding(candidate)
      end
      winner
    end

    def readback(name)
      3.times do |attempt|
        document = read_secret(name)
        return document if document

        @pause.call if attempt < 2
      end
      raise Refusal
    end

    def read_secret(name)
      document = @api.get_secret(name)
      document && @policy.validate(name, document)
    end

    def guard_no_pvcs!
      KubernetesApi::PVC_NAMES.each do |name|
        raise Refusal if @api.get_pvc(name)
      end
    end

    def ensure_same!(expected, actual)
      raise Refusal unless actual && expected.fetch('data') == actual.fetch('data')
      raise Refusal unless @policy.binding(expected) == @policy.binding(actual)
      raise Refusal unless expected.fetch('metadata')['uid'] == actual.fetch('metadata')['uid']
    end
  end

  class Command
    def self.run(arguments: ARGV, out: $stdout, err: $stderr, factory: nil)
      unless arguments == ['--run-in-cluster']
        err.write("namespace secret bootstrap: explicit in-cluster flag required\n")
        return 2
      end
      factory ||= -> { build_generator }
      Timeout.timeout(120) { factory.call.run }
      out.write("namespace secret bootstrap: validated\n")
      0
    rescue StandardError
      err.write("namespace secret bootstrap: refused\n")
      1
    end

    def self.build_generator
      identity = OwnerIdentity.from_volume
      Generator.new(api: KubernetesApi.new, policy: SecretPolicy.new(identity))
    end
    private_class_method :build_generator
  end
end

exit(NamespaceSecrets::Command.run) if $PROGRAM_NAME == __FILE__
