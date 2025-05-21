/**
 * Fetches a static aerial map image URL from Google Maps Static API.
 * @param {string} address The property address.
 * @param {string} apiKey Your Google Maps API key.
 * @returns {Promise<object>} Object containing imageUri or error.
 */
async function fetchStaticAerialImageUrl(address, apiKey) {
    console.log("fetchStaticAerialImageUrl called with address:", address);
    if (!address) {
        console.warn("fetchStaticAerialImageUrl: No address provided.");
        return { imageUri: null, error: "No address provided for Static Aerial Map." };
    }

    const imageWidth = 600;
    const imageHeight = 400;
    const zoomLevel = 18; // Adjust as needed

    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    const params = new URLSearchParams({
        center: address,
        zoom: zoomLevel.toString(),
        size: `${imageWidth}x${imageHeight}`,
        maptype: 'satellite',
        key: apiKey
    });

    const staticMapUrl = `${baseUrl}?${params.toString()}`;
    console.log("Constructed Static Aerial Map URL:", staticMapUrl);
    // The URL itself is the image. If there's an error (e.g. bad API key, invalid address), 
    // Google often returns an error image.
    return { imageUri: staticMapUrl, error: null };
}

/**
 * Fetches a static Street View image URL from Google Street View Static API.
 * @param {string} address The property address.
 * @param {string} apiKey Your Google Maps API key.
 * @returns {Promise<object>} Object containing imageUri or error.
 */
async function fetchStreetViewImageUrl(address, apiKey) {
    console.log("fetchStreetViewImageUrl called with address:", address);
    if (!address) {
        console.warn("fetchStreetViewImageUrl: No address provided.");
        return { imageUri: null, error: "No address provided for Street View." };
    }

    const imageWidth = 600;
    const imageHeight = 400;
    // Optional: Add heading and pitch if desired, or try to get them via Geocoding first.
    // For now, default (front of property if Google can determine it).
    // const heading = 0; 
    // const pitch = 0;

    const baseUrl = "https://maps.googleapis.com/maps/api/streetview";
    const params = new URLSearchParams({
        location: address,
        size: `${imageWidth}x${imageHeight}`,
        // fov: '90', // Field of view, optional
        // heading: heading.toString(), // Optional
        // pitch: pitch.toString(), // Optional
        key: apiKey
    });

    const streetViewUrl = `${baseUrl}?${params.toString()}`;
    console.log("Constructed Street View URL:", streetViewUrl);
    // Similar to Static Maps, the URL is the image. 
    // Google returns a "sorry, we have no imagery here" image if Street View is not available.
    return { imageUri: streetViewUrl, error: null };
}

/**
 * Fetches cinematic aerial video thumbnail URI and video URI from Google Aerial View API.
 * @param {string} address The property address.
 * @param {string} apiKey Your Google Maps API key.
 * @returns {Promise<object>} Object containing imageUri, videoUri, or error.
 */
async function fetchCinematicAerialInfo(address, apiKey) {
    console.log("fetchCinematicAerialInfo called with address:", address);
    if (!address) {
        console.warn("fetchCinematicAerialInfo: No address provided.");
        return { imageUri: null, videoUri: null, error: "No address provided for Cinematic Aerial View." };
    }

    const parameterValue = address;

    function videoIdOrAddress(value) {
        const videoIdRegex = /[0-9a-zA-Z-_]{22}/;
        return value.match(videoIdRegex) ? 'videoId' : 'address';
    }

    const parameterKey = videoIdOrAddress(parameterValue);
    const urlParameter = new URLSearchParams();
    urlParameter.set(parameterKey, parameterValue);
    urlParameter.set('key', apiKey);

    try {
        const response = await fetch(`https://aerialview.googleapis.com/v1/videos:lookupVideo?${urlParameter.toString()}`);
        const videoResult = await response.json();

        if (!response.ok) {
            let errorDetail = 'Failed to fetch cinematic aerial view.';
            if (videoResult && videoResult.error && videoResult.error.message) {
                errorDetail = videoResult.error.message;
            }
            console.error('Cinematic Aerial View API Error:', response.status, errorDetail, 'For address:', parameterValue, 'Full response:', videoResult);
            return { imageUri: null, videoUri: null, error: `Cinematic Aerial View API Error (${response.status}): ${errorDetail}` };
        }

        if (videoResult.state === 'PROCESSING') {
            console.warn('Cinematic aerial video still processing for address:', parameterValue);
            return { imageUri: null, videoUri: null, error: 'Cinematic aerial video still processing.' };
        } else if (videoResult.error && videoResult.error.code === 404) {
            console.warn('Cinematic Aerial View API 404: Video not found for address:', parameterValue);
            return { imageUri: null, videoUri: null, error: 'Cinematic aerial video not found for this address.' };
        } else if (videoResult.uris) {
            const imageUri = videoResult.uris.IMAGE?.landscapeUri || null;
            const videoUri = videoResult.uris.VIDEO_MP4?.landscapeUri || null; // Or other video formats if preferred
            
            if (imageUri) console.log("Cinematic Aerial View Image URI fetched:", imageUri);
            if (videoUri) console.log("Cinematic Aerial View Video URI fetched:", videoUri);
            
            if (!imageUri && !videoUri) {
                console.warn('Cinematic Aerial View API did not return usable URIs for address:', parameterValue, 'Full response:', videoResult);
                return { imageUri: null, videoUri: null, error: 'Cinematic aerial URIs not available. Unexpected API response.' };
            }
            return { imageUri, videoUri, error: null };
        } else {
            console.warn('Cinematic Aerial View API did not return URIs or known error for address:', parameterValue, 'Full response:', videoResult);
            return { imageUri: null, videoUri: null, error: 'Cinematic aerial view data not available.' };
        }
    } catch (error) {
        console.error('Error in fetchCinematicAerialInfo for address:', parameterValue, error);
        return { imageUri: null, videoUri: null, error: `Client-side error fetching cinematic aerial view: ${error.message}` };
    }
}

// Export functions if using ES modules (or attach to a global object for simpler script tag inclusion)
// For use with <script type="module"> in index.html or if app.js is a module:
// export { fetchStaticAerialImageUrl, fetchStreetViewImageUrl, fetchCinematicAerialInfo };

// For simpler <script src="js/googleMapsService.js"></script> and then <script src="js/app.js"></script>
// you might attach them to a global object if app.js is not a module.
// e.g., window.googleMapsService = { fetchStaticAerialImageUrl, fetchStreetViewImageUrl, fetchCinematicAerialInfo };
// For now, assuming app.js will handle how it accesses these if they are in the same global scope or app.js is made a module. 