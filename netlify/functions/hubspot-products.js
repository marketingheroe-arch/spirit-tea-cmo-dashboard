// Netlify Function: hubspot-products.js
// Returns top B2B products by revenue from HubSpot line items
// Called with ?from=YYYY-MM-DD&to=YYYY-MM-DD

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

  // Aggregate by product name
  const productMap = {};
  let after = undefined;
  let hasMore = true;
  let totalRevenue = 0;
  let totalUnits = 0;

  try {
    while (hasMore) {
      const body = {
        filterGroups: [{
          filters: [
            { propertyName: 'amount', operator: 'GT', value: '0' },
            { propertyName: 'createdate', operator: 'GTE', value: String(fromTs) },
            { propertyName: 'createdate', operator: 'LTE', value: String(toTs) }
          ]
        }],
        properties: ['name', 'amount', 'quantity'],
        limit: 100,
        sorts: [{ propertyName: 'createdate', direction: 'ASCENDING' }]
      };
      if (after) body.after = after;

      const res = await fetch('https://api.hubapi.com/crm/v3/objects/line_items/search', {
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

      results.forEach(item => {
        const name = (item.properties?.name || 'Unknown').trim();
        const amount = parseFloat(item.properties?.amount || 0);
        const qty = parseInt(item.properties?.quantity || 1);

        if (amount > 0) {
          if (!productMap[name]) {
            productMap[name] = { revenue: 0, units: 0 };
          }
          productMap[name].revenue += amount;
          productMap[name].units += qty;
          totalRevenue += amount;
          totalUnits += qty;
        }
      });

      if (data.paging?.next?.after && results.length === 100) {
        after = data.paging.next.after;
      } else {
        hasMore = false;
      }
    }

    // Sort by revenue, return top 10
    const sorted = Object.entries(productMap)
      .map(([name, data]) => ({ name, revenue: data.revenue, units: data.units }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 10);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        products: sorted,
        totalRevenue,
        totalUnits,
        uniqueProducts: Object.keys(productMap).length
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
