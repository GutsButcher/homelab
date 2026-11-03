# frozen_string_literal: true

require 'json'
require 'openssl'

class HupoBootstrapConfig
  attr_reader :email, :password, :name, :firebase

  def initialize(environment = ENV)
    @environment = environment
    @email = read('OWNER_EMAIL').to_s.strip.downcase
    @password = read('OWNER_PASSWORD').to_s
    @name = read('OWNER_NAME').to_s.strip
    @name = 'hupo chat owner' if @name.empty?
    @firebase = firebase_input
    validate_owner!
  end

  def self.validate_firebase(project, raw)
    data = JSON.parse(raw)
    valid = data.is_a?(Hash) && data['type'] == 'service_account' &&
            data['project_id'] == project && project.to_s.match?(/\A[a-z][a-z0-9-]{4,28}[a-z0-9]\z/) &&
            data['client_email'].to_s.end_with?('.iam.gserviceaccount.com') &&
            data['token_uri'] == 'https://oauth2.googleapis.com/token'
    raise ArgumentError, 'invalid Firebase service account metadata' unless valid

    key = OpenSSL::PKey.read(data.fetch('private_key'))
    raise ArgumentError, 'Firebase key is not a private RSA key' unless key.is_a?(OpenSSL::PKey::RSA) && key.private?

    { project: project, credentials: JSON.generate(data) }
  end

  private

  def read(key)
    direct = @environment[key]
    path = @environment["#{key}_FILE"]
    return direct if path.to_s.empty?

    raise ArgumentError, 'ambiguous input source' unless direct.to_s.empty?

    File.binread(path).sub(/\r?\n\z/, '')
  end

  def firebase_input
    project = read('FIREBASE_PROJECT_ID').to_s
    credentials = read('FIREBASE_CREDENTIALS').to_s
    return nil if project.empty? && credentials.empty?
    raise ArgumentError, 'both Firebase inputs are required' if project.empty? || credentials.empty?

    self.class.validate_firebase(project, credentials)
  end

  def validate_owner!
    raise ArgumentError, 'verified owner email is required' unless read('OWNER_EMAIL_VERIFIED') == 'true'
    raise ArgumentError, 'invalid owner email' unless @email.match?(/\A[^\s@]+@[^\s@]+\.[^\s@]+\z/)

    strong = @password.length >= 16 && @password.match?(/[a-z]/) && @password.match?(/[A-Z]/) &&
             @password.match?(/[0-9]/) && @password.match?(/[^A-Za-z0-9\s]/) && !@password.include?("\n")
    raise ArgumentError, 'owner password does not meet bootstrap policy' unless strong
  end
end
