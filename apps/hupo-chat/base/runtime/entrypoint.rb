# frozen_string_literal: true

require 'fileutils'

SECRET_KEYS = %w[
  SECRET_KEY_BASE POSTGRES_PASSWORD REDIS_PASSWORD
  ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY
  ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT SMTP_PASSWORD
].freeze

begin
  SECRET_KEYS.each do |key|
    path = ENV["#{key}_FILE"]
    next if path.nil? || path.empty?

    raise ArgumentError, 'ambiguous secret source' unless ENV[key].to_s.empty?

    ENV[key] = File.binread(path).sub(/\r?\n\z/, '')
  end
  (SECRET_KEYS - ['SMTP_PASSWORD']).each do |key|
    raise ArgumentError, 'missing runtime secret' if ENV[key].to_s.empty?
  end
  unless ENV.fetch('REDIS_PASSWORD').match?(/\A[A-Za-z0-9]{32,}\z/)
    raise ArgumentError, 'Redis password must be at least 32 alphanumeric characters'
  end
  raise ArgumentError, 'missing command' if ARGV.empty?

  FileUtils.mkdir_p('/app/tmp/pids')
  FileUtils.rm_f('/app/tmp/pids/server.pid') if ARGV.include?('s')

  if ARGV.include?('db:chatwoot_prepare')
    exit(1) unless system(*ARGV)

    exec('bundle', 'exec', 'rails', 'runner', '/opt/hupo-chat/lock_onboarding.rb')
  end

  if ENV.fetch('ENABLE_PUSH_RELAY_SERVER', 'true') == 'false'
    ok = system('bundle', 'exec', 'rails', 'runner', '/opt/hupo-chat/check_fcm.rb')
    raise ArgumentError, 'direct FCM is not configured' unless ok
  end
  exec(*ARGV)
rescue StandardError => error
  warn "hupo-chat startup refused (#{error.class}); check secret/configuration inputs"
  exit(1)
end
