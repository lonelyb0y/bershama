import { getRequestConfig } from 'next-intl/server';
import { defaultLocale, isLocale } from './routing';

// Messages are loaded per-locale on the server. The bundle ships only the active
// locale, so an Arabic-speaking driver on a phone in the field does not download
// the English catalogue too.
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: (await import(`./messages/${locale}.json`)).default,
    // Dates and numbers follow Egyptian conventions regardless of UI language.
    // A pharmacist reading Arabic still expects a Gregorian expiry date they can
    // match against the carton.
    timeZone: 'Africa/Cairo',
  };
});
