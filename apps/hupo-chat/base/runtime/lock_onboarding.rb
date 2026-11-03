# frozen_string_literal: true

# Upstream production seeds enable public first-run SuperAdmin onboarding.
# Only the owner-supplied bootstrap job may create the first account here.
Redis::Alfred.delete(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)
raise 'onboarding lock readback failed' if Redis::Alfred.get(Redis::Alfred::CHATWOOT_INSTALLATION_ONBOARDING)

puts 'public installation onboarding is locked; run the owner bootstrap job'
