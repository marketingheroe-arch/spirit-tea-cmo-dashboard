// Netlify Function: hubspot-orders.js
// Proxies HubSpot Orders API server-side to avoid CORS issues
// Called by dashboard with ?from=YYYY-MM-DD&to=YYYY-MM-DD

const HS_TOKEN = process.env.HUBSPOT_TOKEN;

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const { from, to } = event.queryStringParameters || {};
  if (!from || !to) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing from/to params' }) };
  }

  const fromTs = new Date(from).getTime();
  const toTs = new Date(to).getTime() + 86400000 - 1;

  let totalRevenue = 0;
  let orderCount = 0;
  let after = undefined;
  let hasMore = true;

  try {
    while (hasMore) {
      const body = {
        filterGroups: [{
          filters: [
            { propertyName: 'hs_total_price', operator: 'GT', value: '0' },
            { propertyName: 'hs_createdate', operator: 'GTE', value: String(fromTs) },
            { propertyName: 'hs_createdate', operator: 'LTE', value: String(toTs) }
          ]
        }],
        properties: ['hs_total_price'],
        limit: 100,
        sorts: [{ propertyName: 'hs_createdate', direction: 'ASCENDING' }]
      };
      if (after) body.after = after;

      const res = await fetch('https://api.hubapi.com/crm/v3/objects/orders/search', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + HS_TOKEN,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json();
        return {
          statusCode: res.status,
          headers,
          body: JSON.stringify({ error: err.message || 'HubSpot API error' })
        };
      }

      const data = await res.json();
      const results = data.results || [];

      results.forEach(order => {
        const price = parseFloat(order.properties?.hs_total_price || 0);
        if (price > 0) {
          totalRevenue += price;
          orderCount++;
        }
      });

      if (data.paging?.next?.after && results.length === 100) {
        after = data.paging.next.after;
      } else {
        hasMore = false;
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        revenue: totalRevenue,
        orders: orderCount,
        aov: orderCount > 0 ? totalRevenue / orderCount : 0
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message })
    };
  }
};
