import { describe, it, expect } from 'vitest';

describe('Klaviyo API Key Validation', () => {
  const KLAVIYO_API_KEY = process.env.KLAVIYO_API_KEY;

  it('should have KLAVIYO_API_KEY set', () => {
    expect(KLAVIYO_API_KEY).toBeDefined();
    expect(KLAVIYO_API_KEY).not.toBe('');
    expect(KLAVIYO_API_KEY!.startsWith('pk_')).toBe(true);
  });

  it('should be able to fetch profiles from Klaviyo API', async () => {
    const response = await fetch(
      'https://a.klaviyo.com/api/profiles?page[size]=1&additional-fields[profile]=subscriptions',
      {
        headers: {
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          'accept': 'application/vnd.api+json',
          'revision': '2026-01-15',
        },
      }
    );

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data).toBeDefined();
    expect(Array.isArray(data.data)).toBe(true);

    // Log the subscription structure for debugging
    if (data.data.length > 0) {
      const profile = data.data[0];
      console.log('Profile ID:', profile.id);
      console.log('Email:', profile.attributes?.email);
      console.log('Subscriptions keys:', JSON.stringify(Object.keys(profile.attributes?.subscriptions || {})));
      console.log('Full subscriptions:', JSON.stringify(profile.attributes?.subscriptions, null, 2));
    }
  });

  it('should be able to search profiles by email', async () => {
    // First get any profile to use its email
    const listResponse = await fetch(
      'https://a.klaviyo.com/api/profiles?page[size]=1',
      {
        headers: {
          'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
          'accept': 'application/vnd.api+json',
          'revision': '2026-01-15',
        },
      }
    );

    const listData = await listResponse.json();
    if (listData.data && listData.data.length > 0) {
      const email = listData.data[0].attributes?.email;
      if (email) {
        const searchResponse = await fetch(
          `https://a.klaviyo.com/api/profiles?filter=equals(email,"${email}")&additional-fields[profile]=subscriptions`,
          {
            headers: {
              'Authorization': `Klaviyo-API-Key ${KLAVIYO_API_KEY}`,
              'accept': 'application/vnd.api+json',
              'revision': '2026-01-15',
            },
          }
        );

        expect(searchResponse.status).toBe(200);
        const searchData = await searchResponse.json();
        expect(searchData.data.length).toBeGreaterThan(0);
        console.log('Search by email result - subscriptions:', JSON.stringify(searchData.data[0].attributes?.subscriptions, null, 2));
      }
    }
  });
});
