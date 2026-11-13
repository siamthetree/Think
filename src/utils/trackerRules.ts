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

export const TRACKER_HOST_PATTERNS: string[] = [
  'doubleclick.net',
  'google-analytics.com',
  'googletagmanager.com',
  'googlesyndication.com',
  'googleadservices.com',
  '2mdn.net',
  'facebook.net',
  'connect.facebook.net',
  'analytics.twitter.com',
  'ads-twitter.com',
  't.co',
  'amazon-adsystem.com',
  'adnxs.com',
  'rubiconproject.com',
  'pubmatic.com',
  'openx.net',
  'casalemedia.com',
  'scorecardresearch.com',
  'sb.scorecardresearch.com',
  'quantserve.com',
  'pixel.quantserve.com',
  'outbrain.com',
  'taboola.com',
  'criteo.com',
  'criteo.net',
  'chartbeat.com',
  'chartbeat.net',
  'parsely.com',
  'pixel.parsely.com',
  'hotjar.com',
  'mixpanel.com',
  'segment.io',
  'segment.com',
  'clarity.ms',
  'bat.bing.com',
  'newrelic.com',
  'nr-data.net',
  'bugsnag.com',
  'omtrdc.net',
  '2o7.net',
  'demdex.net',
  'everesttech.net',
  'krxd.net',
  'bluekai.com',
  'exelator.com',
  'rlcdn.com',
  'tapad.com',
  'adsrvr.org',
  'adform.net',
  'moatads.com',
  'doubleverify.com',
  'iasds01.com',
  'adsafeprotected.com',
  'teads.tv',
  'sharethrough.com',
  'smartadserver.com',
  'zemanta.com',
  'revcontent.com',
  'mgid.com',
  'adroll.com',
  'perfectaudience.com',
  'liadm.com',
  'pippio.com',
  'agkn.com',
  'mathtag.com',
  'mookie1.com',
  'bidswitch.net',
  'contextweb.com',
  'indexexchange.com',
  'spotxchange.com',
  'tremorhub.com',
  'serving-sys.com',
  'flashtalking.com',
  'celtra.com',
  'innovid.com',
  'extreme-dm.com',
  'statcounter.com',
  'histats.com',
  'mc.yandex.ru',
  'top.mail.ru',
  'analytics.tiktok.com',
  'tr.snapchat.com',
  'ct.pinterest.com',
  'trk.pinterest.com',
  'px.ads.linkedin.com',
  'dc.ads.linkedin.com',
  'alb.reddit.com',
  'events.redditmedia.com',
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
      return rawUrl;
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
    const parsed = new URL(rawUrl.trim(), 'https://placeholder.invalid');
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'placeholder.invalid') return false;

    for (const pattern of TRACKER_HOST_PATTERNS) {
      const p = pattern.toLowerCase();
      if (host === p || host.endsWith(`.${p}`)) {
        return true;
      }
    }

    const lowerPath = parsed.pathname.toLowerCase();
    if (
      (host === 'facebook.com' || host.endsWith('.facebook.com')) &&
      (lowerPath === '/tr' || lowerPath.startsWith('/tr/'))
    ) {
      return true;
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

export function isTrackingPixel(el: {
  getAttribute(name: string): string | null;
}): boolean {
  if (!el || typeof el.getAttribute !== 'function') return false;

  const width = (el.getAttribute('width') || '').trim().toLowerCase();
  const height = (el.getAttribute('height') || '').trim().toLowerCase();

  const isZeroOrOne = (val: string) =>
    val === '0' || val === '1' || val === '0px' || val === '1px';

  if (isZeroOrOne(width) || isZeroOrOne(height)) {
    return true;
  }

  const styleRaw = (el.getAttribute('style') || '').toLowerCase();
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
      /(?:^|;)width:(?:0|1)(?:px)?;/.test(compactStyle) ||
      /(?:^|;)height:(?:0|1)(?:px)?;/.test(compactStyle)
    ) {
      return true;
    }
  }

  const src = el.getAttribute('src') || el.getAttribute('data-src') || '';
  if (src && isTrackerUrl(src)) {
    return true;
  }

  return false;
}
