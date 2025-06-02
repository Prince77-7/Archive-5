/**
 * Validates coordinates by reverse geocoding and provides fallback
 * @param {object} coordinates The coordinates to validate
 * @param {string} address The original address for comparison
 * @param {string} apiKey Google Maps API key
 * @returns {Promise<object>} Validated coordinates or null
 */
async function validateCoordinates(coordinates, address, apiKey) {
    if (!coordinates || !coordinates.lat || !coordinates.lng) {
        return null;
    }

    try {
        // Use Google's Reverse Geocoding to validate the coordinates
        const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${coordinates.lat},${coordinates.lng}&key=${apiKey}`;
        const response = await fetch(geocodeUrl);
        const data = await response.json();

        if (data.status === 'OK' && data.results.length > 0) {
            const result = data.results[0];
            const formattedAddress = result.formatted_address;
            
            // Check if the reverse geocoded address is in Shelby County
            const isShelbyCounty = formattedAddress.toLowerCase().includes('shelby') && 
                                  formattedAddress.toLowerCase().includes('tn');
            
            if (isShelbyCounty) {
                console.log(`Coordinates validated. Reverse geocoded to: ${formattedAddress}`);
                return coordinates;
            } else {
                console.warn(`Coordinates point outside Shelby County: ${formattedAddress}`);
                return null;
            }
        } else {
            console.warn('Geocoding validation failed:', data.status);
            return null;
        }
    } catch (error) {
        console.warn('Error validating coordinates:', error);
        return null;
    }
}

/**
 * Fetches a static aerial map image URL from Google Maps Static API.
 * @param {string} address The property address.
 * @param {string} apiKey Your Google Maps API key.
 * @param {object} options Optional parameters including coordinates.
 * @returns {Promise<object>} Object containing imageUri or error.
 */
async function fetchStaticAerialImageUrl(address, apiKey, options = {}) {
    console.log("fetchStaticAerialImageUrl called with address:", address, "options:", options);
    if (!address && !options.coordinates) {
        console.warn("fetchStaticAerialImageUrl: No address or coordinates provided.");
        return { imageUri: null, error: "No address or coordinates provided for Static Aerial Map." };
    }

    const imageWidth = 800;  // Increased resolution
    const imageHeight = 600; // Increased resolution
    const zoomLevel = 19; // Increased zoom for better detail

    const baseUrl = "https://maps.googleapis.com/maps/api/staticmap";
    const params = new URLSearchParams({
        zoom: zoomLevel.toString(),
        size: `${imageWidth}x${imageHeight}`,
        maptype: 'satellite',
        format: 'png',
        scale: '2', // High DPI for better quality
        key: apiKey
    });

    // Validate coordinates if provided
    let validatedCoordinates = null;
    if (options.coordinates && options.coordinates.lat && options.coordinates.lng) {
        validatedCoordinates = await validateCoordinates(options.coordinates, address, apiKey);
    }

    // Use validated coordinates if available, otherwise use address
    if (validatedCoordinates) {
        const coordString = `${validatedCoordinates.lat},${validatedCoordinates.lng}`;
        params.set('center', coordString);
        
        // Add a marker at the exact coordinates with a distinct style
        params.set('markers', `color:red|size:normal|label:P|${coordString}`);
        
        console.log("Static Map: Using validated coordinates:", validatedCoordinates);
        console.log("Static Map: Center point:", coordString);
    } else {
        // Clean up the address for better geocoding
        const cleanAddress = address.replace(/\s+/g, ' ').trim();
        let searchAddress = cleanAddress;
        
        // Add Shelby County, TN to help with geocoding accuracy
        if (!cleanAddress.toLowerCase().includes('tn') && !cleanAddress.toLowerCase().includes('tennessee')) {
            searchAddress = `${cleanAddress}, Shelby County, TN`;
        }
        
        params.set('center', searchAddress);
        params.set('markers', `color:red|size:normal|label:A|${searchAddress}`);
        console.log("Static Map: Using address (coordinates failed validation):", searchAddress);
    }

    const staticMapUrl = `${baseUrl}?${params.toString()}`;
    console.log("Constructed Static Aerial Map URL:", staticMapUrl);
    
    return { imageUri: staticMapUrl, error: null };
}

/**
 * Captures a screenshot of the current ArcGIS MapView including all overlays and graphics.
 * @param {esri/views/MapView} mapView The ArcGIS MapView instance.
 * @param {object} options Screenshot options (width, height, format, quality).
 * @returns {Promise<object>} Object containing imageUri or error.
 */
async function captureMapViewScreenshot(mapView, options = {}) {
    console.log("captureMapViewScreenshot called with options:", options);
    
    if (!mapView) {
        console.warn("captureMapViewScreenshot: No mapView provided.");
        return { imageUri: null, error: "No map view provided for screenshot." };
    }

    try {
        // Default screenshot options
        const screenshotOptions = {
            width: options.width || 800,
            height: options.height || 600,
            format: options.format || "png",
            quality: options.quality || 95,
            ...options
        };

        // Take screenshot using ArcGIS API
        const screenshot = await mapView.takeScreenshot(screenshotOptions);
        
        if (screenshot && screenshot.dataUrl) {
            console.log("Map screenshot captured successfully");
            return { imageUri: screenshot.dataUrl, error: null };
        } else {
            console.warn("Screenshot was taken but no dataUrl returned");
            return { imageUri: null, error: "Screenshot captured but no image data returned." };
        }
    } catch (error) {
        console.error("Error capturing map screenshot:", error);
        return { imageUri: null, error: `Error capturing map screenshot: ${error.message}` };
    }
}

/**
 * Fetches a static Street View image URL from Google Street View Static API.
 * @param {string} address The property address.
 * @param {string} apiKey Your Google Maps API key.
 * @param {object} options Optional parameters including coordinates.
 * @returns {Promise<object>} Object containing imageUri or error.
 */
async function fetchStreetViewImageUrl(address, apiKey, options = {}) {
    console.log("fetchStreetViewImageUrl called with address:", address, "options:", options);
    if (!address && !options.coordinates) {
        console.warn("fetchStreetViewImageUrl: No address or coordinates provided.");
        return { imageUri: null, error: "No address or coordinates provided for Street View." };
    }

    const imageWidth = 800;  // Increased resolution
    const imageHeight = 600; // Increased resolution

    const baseUrl = "https://maps.googleapis.com/maps/api/streetview";
    const params = new URLSearchParams({
        size: `${imageWidth}x${imageHeight}`,
        fov: '90', // Field of view
        pitch: '0', // Looking straight ahead
        format: 'png',
        key: apiKey
    });

    // Use coordinates if available for more precise location
    if (options.coordinates && options.coordinates.lat && options.coordinates.lng) {
        params.set('location', `${options.coordinates.lat},${options.coordinates.lng}`);
        console.log("Using coordinates for street view:", options.coordinates);
    } else {
        // Clean up the address for better geocoding
        const cleanAddress = address.replace(/\s+/g, ' ').trim();
        params.set('location', cleanAddress);
        
        // Add Shelby County, TN to help with geocoding accuracy
        if (!cleanAddress.toLowerCase().includes('tn') && !cleanAddress.toLowerCase().includes('tennessee')) {
            params.set('location', `${cleanAddress}, Shelby County, TN`);
        }
    }

    // Add radius parameter to search for imagery within reasonable distance
    params.set('radius', '50'); // 50 meter radius

    const streetViewUrl = `${baseUrl}?${params.toString()}`;
    console.log("Constructed Street View URL:", streetViewUrl);
    
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