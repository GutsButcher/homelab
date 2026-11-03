# frozen_string_literal: true

require '/opt/hupo-chat/bootstrap_config'

class HupoOwnerBootstrap
  def run
    # Model SQL/error logs can contain serialized service-account credentials.
    ActiveRecord::Base.logger = nil
    Rails.logger.level = Logger::FATAL
    config = HupoBootstrapConfig.new
    owner = nil
    account = nil
    ActiveRecord::Base.transaction do
      ActiveRecord::Base.connection.execute("SELECT pg_advisory_xact_lock(hashtext('hupo-chat-owner-bootstrap'))")
      owner, account = find_or_create_owner(config)
      configure_installation(config)
    end
    Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
    verify!(owner, account, config)
    puts JSON.generate(status: 'ok', owner_id: owner.id, account_id: account.id,
                       locale: account.locale, firebase_inputs_applied: !config.firebase.nil?,
                       push_delivery_verified: false)
  rescue StandardError => error
    warn "owner bootstrap refused (#{error.class}); no secret details emitted"
    exit(1)
  end

  private

  def find_or_create_owner(config)
    owner = User.from_email(config.email)
    accounts = Account.where("custom_attributes ->> 'hupo_chat_bootstrap' = ?", 'true').limit(2).to_a
    if owner || accounts.any?
      raise 'ambiguous existing installation' unless owner && accounts.length == 1

      account = accounts.first
      membership = account.account_users.find_by(user_id: owner.id)
      valid = owner.is_a?(SuperAdmin) && owner.confirmed? && owner.valid_password?(config.password) &&
              membership&.administrator? && account.custom_attributes['hupo_chat_owner_id'] == owner.id
      raise 'existing owner does not match bootstrap inputs' unless valid

      account.update!(name: 'hupo chat', locale: :ar)
      return [owner, account]
    end
    raise 'refusing to adopt an existing installation' if User.exists? || Account.exists?

    owner, account = I18n.with_locale(:ar) do
      AccountBuilder.new(account_name: 'hupo chat', email: config.email, confirmed: true,
                         user_full_name: config.name, user_password: config.password,
                         super_admin: true).perform
    end
    account.update!(locale: :ar, custom_attributes: account.custom_attributes.merge(
      'hupo_chat_bootstrap' => true, 'hupo_chat_owner_id' => owner.id
    ))
    [owner, account]
  end

  def configure_installation(config)
    write_config('ENABLE_ACCOUNT_SIGNUP', false)
    write_config('CREATE_NEW_ACCOUNT_FROM_DASHBOARD', false)
    if config.firebase
      write_config('FIREBASE_PROJECT_ID', config.firebase.fetch(:project))
      write_config('FIREBASE_CREDENTIALS', config.firebase.fetch(:credentials))
    end
    return unless ENV.fetch('ENABLE_PUSH_RELAY_SERVER', 'true') == 'false'

    HupoBootstrapConfig.validate_firebase(
      InstallationConfig.find_by!(name: 'FIREBASE_PROJECT_ID').value,
      InstallationConfig.find_by!(name: 'FIREBASE_CREDENTIALS').value
    )
  end

  def write_config(name, value)
    record = InstallationConfig.find_or_initialize_by(name: name)
    record.value = value
    record.save!
  end

  def verify!(owner, account, config)
    raise 'owner readback failed' unless User.find(owner.id).valid_password?(config.password)
    raise 'locale readback failed' unless Account.find(account.id).locale == 'ar'
    raise 'signup readback failed' unless InstallationConfig.find_by!(name: 'ENABLE_ACCOUNT_SIGNUP').value == false
    return unless config.firebase

    actual = InstallationConfig.find_by!(name: 'FIREBASE_CREDENTIALS').value
    raise 'FCM configuration readback failed' unless actual == config.firebase.fetch(:credentials)
  end
end

HupoOwnerBootstrap.new.run
