const TRACKING_PARAMS = new Set([
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'utm_id',
  'utm_name',
  'utm_reader',
  'utm_viz_id',
  'utm_pubreferrer',
  'utm_swu',
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'msclkid',
  'twclid',
  'yclid',
  'ttclid',
  'wbraid',
  'gbraid',
  'li_fat_id',
  'epik',
  'rdt_cid',
  'mc_cid',
  'mc_eid',
  'oly_enc_id',
  'oly_anon_id',
  '_hsenc',
  '_hsmi',
  'hsCtaTracking',
  'hscam',
  'hsa_acc',
  'hsa_cam',
  'hsa_grp',
  'hsa_ad',
  'hsa_src',
  'hsa_tgt',
  'hsa_kw',
  'hsa_mt',
  'hsa_net',
  'hsa_ver',
  'vero_id',
  'vero_conv',
  'mkt_tok',
  'igshid',
  'igsh',
  'si',
  'ref_src',
  'ref_url',
  'ncid',
  'cmpid',
  'ito',
  'itid',
  'sr_share',
  'spm',
  'scm',
  's_kwcid',
  'rb_clickid',
  'nr_email_referer',
  'sc_cid',
  'trk',
  'trkcampaign',
  '_ga',
  '_gl',
  'ga_source',
  'ga_medium',
  'ga_campaign',
  'ga_term',
  'ga_content',
  'pk_campaign',
  'pk_kwd',
  'pk_source',
  'pk_medium',
  'pk_content',
  'piwik_campaign',
  'piwik_kwd',
  'mtm_campaign',
  'mtm_source',
  'mtm_medium',
  'mtm_kwd',
  'mtm_content',
  'mtm_cid',
  'mtm_group',
  'mtm_placement',
  'wt.mc_id',
  'wt.z_oss',
]);

const TRACKING_PARAM_PREFIXES = [
  'utm_',
  'mtm_',
  'pk_',
  'hsa_',
  'ga_',
  'matomo_',
];

export interface TrackerHostPattern {
  host: string;
  pathPrefix?: string;
}

export const TRACKER_HOST_PATTERNS: TrackerHostPattern[] = [
  { host: 'doubleclick.net' },
  { host: 'google-analytics.com' },
  { host: 'googletagmanager.com' },
  { host: 'googlesyndication.com' },
  { host: 'googleadservices.com' },
  { host: '2mdn.net' },
  { host: 'facebook.net' },
  { host: 'connect.facebook.net' },
  { host: 'facebook.com', pathPrefix: '/tr' },
  { host: 'analytics.twitter.com' },
  { host: 'ads-twitter.com' },
  { host: 't.co' },
  { host: 'amazon-adsystem.com' },
  { host: 'adnxs.com' },
  { host: 'rubiconproject.com' },
  { host: 'pubmatic.com' },
  { host: 'openx.net' },
  { host: 'casalemedia.com' },
  { host: 'scorecardresearch.com' },
  { host: 'quantserve.com' },
  { host: 'outbrain.com' },
  { host: 'taboola.com' },
  { host: 'criteo.com' },
  { host: 'criteo.net' },
  { host: 'chartbeat.com' },
  { host: 'chartbeat.net' },
  { host: 'parsely.com' },
  { host: 'pixel.wp.com' },
  { host: 'feeds.feedburner.com', pathPrefix: '/~r/' },
  { host: 'substack.com', pathPrefix: '/o/' },
  { host: 'list-manage.com', pathPrefix: '/track/' },
  { host: 'hotjar.com' },
  { host: 'mixpanel.com' },
  { host: 'segment.io' },
  { host: 'segment.com' },
  { host: 'clarity.ms' },
  { host: 'bat.bing.com' },
  { host: 'newrelic.com' },
  { host: 'nr-data.net' },
  { host: 'bugsnag.com' },
  { host: 'omtrdc.net' },
  { host: '2o7.net' },
  { host: 'demdex.net' },
  { host: 'everesttech.net' },
  { host: 'krxd.net' },
  { host: 'bluekai.com' },
  { host: 'exelator.com' },
  { host: 'rlcdn.com' },
  { host: 'tapad.com' },
  { host: 'adsrvr.org' },
  { host: 'adform.net' },
  { host: 'moatads.com' },
  { host: 'doubleverify.com' },
  { host: 'iasds01.com' },
  { host: 'adsafeprotected.com' },
  { host: 'teads.tv' },
  { host: 'sharethrough.com' },
  { host: 'smartadserver.com' },
  { host: 'zemanta.com' },
  { host: 'revcontent.com' },
  { host: 'mgid.com' },
  { host: 'adroll.com' },
  { host: 'perfectaudience.com' },
  { host: 'liadm.com' },
  { host: 'pippio.com' },
  { host: 'agkn.com' },
  { host: 'mathtag.com' },
  { host: 'mookie1.com' },
  { host: 'bidswitch.net' },
  { host: 'contextweb.com' },
  { host: 'indexexchange.com' },
  { host: 'spotxchange.com' },
  { host: 'tremorhub.com' },
  { host: 'serving-sys.com' },
  { host: 'flashtalking.com' },
  { host: 'celtra.com' },
  { host: 'innovid.com' },
  { host: 'extreme-dm.com' },
  { host: 'statcounter.com' },
  { host: 'histats.com' },
  { host: 'mc.yandex.ru' },
  { host: 'top.mail.ru' },
  { host: 'analytics.tiktok.com' },
  { host: 'tr.snapchat.com' },
  { host: 'ct.pinterest.com' },
  { host: 'trk.pinterest.com' },
  { host: 'px.ads.linkedin.com' },
  { host: 'dc.ads.linkedin.com' },
  { host: 'alb.reddit.com' },
  { host: 'events.redditmedia.com' },
];

export function stripTrackingParams(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return rawUrl;
  const trimmed = rawUrl.trim();
  if (!/^https?:\/\//i.test(trimmed)) return rawUrl;

  try {
    const parsed = new URL(trimmed);
    const keysToDelete: string[] = [];

    parsed.searchParams.forEach((_value, key) => {
      const lower = key.toLowerCase();
      if (
        TRACKING_PARAMS.has(key) ||
        TRACKING_PARAMS.has(lower) ||
        TRACKING_PARAM_PREFIXES.some((prefix) => lower.startsWith(prefix))
      ) {
        keysToDelete.push(key);
      }
    });

    if (keysToDelete.length === 0) {
      return trimmed.endsWith('?') ? trimmed.slice(0, -1) : rawUrl;
    }

    for (const k of keysToDelete) {
      parsed.searchParams.delete(k);
    }

    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

export function isTrackerUrl(rawUrl: string): boolean {
  if (!rawUrl || typeof rawUrl !== 'string') return false;
  try {
    const trimmed = rawUrl.trim();
    if (!trimmed) return false;
    const isAbsoluteOrProtoRel = /^https?:\/\//i.test(trimmed) || trimmed.startsWith('//');
    const parsed = isAbsoluteOrProtoRel
      ? new URL(trimmed.startsWith('//') ? `https:${trimmed}` : trimmed)
      : new URL(trimmed, 'https://www.thedailystar.net');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = isAbsoluteOrProtoRel ? parsed.hostname.toLowerCase().replace(/\.$/, '') : '';

    const lowerPath = parsed.pathname.toLowerCase();

    for (const pattern of TRACKER_HOST_PATTERNS) {
      const p = pattern.host.toLowerCase();
      if (host === p || host.endsWith(`.${p}`)) {
        if (!pattern.pathPrefix) {
          return true;
        }
        const pref = pattern.pathPrefix.toLowerCase();
        if (lowerPath === pref || lowerPath.startsWith(pref)) {
          return true;
        }
      }
    }

    if (
      lowerPath.endsWith('/1x1.gif') ||
      lowerPath.endsWith('/pixel.gif') ||
      lowerPath.endsWith('/spacer.gif') ||
      lowerPath.endsWith('/clear.gif') ||
      lowerPath.endsWith('/beacon.gif') ||
      lowerPath.includes('/__utm.gif')
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export type TrackingPixelCandidate =
  | { getAttribute(name: string): string | null }
  | {
      width?: string | null;
      height?: string | null;
      style?: string | null;
      src?: string | null;
      getAttribute?: (name: string) => string | null;
    };

export function isTrackingPixel(el: TrackingPixelCandidate): boolean {
  if (!el) return false;

  const readAttr = (name: 'width' | 'height' | 'style' | 'src' | 'data-src'): string => {
    if (typeof (el as { getAttribute?: unknown }).getAttribute === 'function') {
      return ((el as { getAttribute(n: string): string | null }).getAttribute(name) || '').trim();
    }
    const rec = el as Record<string, string | null | undefined>;
    return (rec[name] || '').trim();
  };

  const width = readAttr('width').toLowerCase();
  const height = readAttr('height').toLowerCase();

  const isZeroOrOne = (val: string) =>
    val === '0' || val === '1' || val === '0px' || val === '1px';

  if (isZeroOrOne(width) || isZeroOrOne(height)) {
    return true;
  }

  const styleRaw = readAttr('style').toLowerCase();
  if (styleRaw) {
    const compactStyle = styleRaw.replace(/\s+/g, '');
    if (
      compactStyle.includes('display:none') ||
      compactStyle.includes('visibility:hidden') ||
      compactStyle.includes('opacity:0') ||
      compactStyle.includes('width:0px') ||
      compactStyle.includes('width:1px') ||
      compactStyle.includes('height:0px') ||
      compactStyle.includes('height:1px') ||
      /(?:^|;)width:(?:0|1)(?:px)?(?:;|$)/.test(compactStyle) ||
      /(?:^|;)height:(?:0|1)(?:px)?(?:;|$)/.test(compactStyle)
    ) {
      return true;
    }
  }

  const src = readAttr('src') || readAttr('data-src');
  if (src && isTrackerUrl(src)) {
    return true;
  }

  return false;
}
