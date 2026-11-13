export interface PrivacySettings {
  connectionMode: 'relay' | 'direct';
  blockThirdPartyMedia: boolean;
  tapToLoadMedia: boolean;
}

export const PRIVACY_SETTINGS_KEY = 'chinta_privacy_settings';

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  connectionMode: 'relay',
  blockThirdPartyMedia: true,
  tapToLoadMedia: false,
};

export function loadPrivacySettingsFromStorage(): PrivacySettings {
  try {
    const raw = localStorage.getItem(PRIVACY_SETTINGS_KEY);
    if (!raw) return DEFAULT_PRIVACY_SETTINGS;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return DEFAULT_PRIVACY_SETTINGS;

    return {
      // Always enforce 'relay' so publishers and third parties can never see the user's IP
      connectionMode: 'relay',
      blockThirdPartyMedia:
        typeof parsed.blockThirdPartyMedia === 'boolean'
          ? parsed.blockThirdPartyMedia
          : DEFAULT_PRIVACY_SETTINGS.blockThirdPartyMedia,
      tapToLoadMedia:
        typeof parsed.tapToLoadMedia === 'boolean'
          ? parsed.tapToLoadMedia
          : DEFAULT_PRIVACY_SETTINGS.tapToLoadMedia,
    };
  } catch {
    return DEFAULT_PRIVACY_SETTINGS;
  }
}

export function savePrivacySettingsToStorage(settings: PrivacySettings): void {
  try {
    const safeSettings: PrivacySettings = {
      ...settings,
      connectionMode: 'relay',
    };
    localStorage.setItem(PRIVACY_SETTINGS_KEY, JSON.stringify(safeSettings));
  } catch {
    // Ignore storage write errors
  }
}
