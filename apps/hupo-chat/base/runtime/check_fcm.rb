# frozen_string_literal: true

require '/opt/hupo-chat/bootstrap_config'

begin
  ActiveRecord::Base.logger = nil
  Rails.logger.level = Logger::FATAL
  project = InstallationConfig.find_by!(name: 'FIREBASE_PROJECT_ID').value
  credentials = InstallationConfig.find_by!(name: 'FIREBASE_CREDENTIALS').value
  HupoBootstrapConfig.validate_firebase(project, credentials)
  puts 'direct FCM configuration exists; delivery is not verified'
rescue StandardError => error
  warn "direct FCM configuration check failed (#{error.class}); relay must remain enabled"
  exit(1)
end
