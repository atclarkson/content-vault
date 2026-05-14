let lastRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForRateLimit() {
  const elapsed = Date.now() - lastRequestAt;

  if (elapsed < 1000) {
    await sleep(1000 - elapsed);
  }

  lastRequestAt = Date.now();
}

function pickFirst(address, fields) {
  for (const field of fields) {
    if (address[field]) {
      return address[field];
    }
  }

  return null;
}

async function reverseGeocode(lat, lng) {
  try {
    await waitForRateLimit();

    const url =
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": "content-vault/1.0"
      }
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const address = data.address || {};

    return {
      neighborhood: pickFirst(address, ["neighbourhood", "suburb", "quarter"]),
      city: pickFirst(address, ["city", "town", "village", "municipality"]),
      region: address.state || null,
      country: address.country || null
    };
  } catch (error) {
    return null;
  }
}

module.exports = reverseGeocode;
