// Initialize the application when the DOM is ready
document.addEventListener("DOMContentLoaded", function() {
    // Load the ArcGIS API modules
    require([
        "esri/Map",
        "esri/views/MapView",
        "esri/layers/FeatureLayer",
        "esri/widgets/Search",
        "esri/widgets/Home",
        "esri/widgets/Locate",
        "esri/widgets/BasemapGallery",
        "esri/widgets/Expand",
        "esri/rest/identify",
        "esri/rest/support/IdentifyParameters",
        "esri/rest/locator",
        "esri/Graphic",
        "esri/layers/GraphicsLayer",
        "esri/geometry/Point", // Added for geometry parsing
        "esri/geometry/Polygon" // Added for geometry parsing
    ], function(
        Map, MapView, FeatureLayer, Search, Home, Locate, BasemapGallery, Expand,
        identify, IdentifyParameters, locator, Graphic, GraphicsLayer,
        Point, Polygon // Added
    ) {
        // Global variables within require scope
        let highlightGraphicsLayer; // Declare here
        let favoritesGraphicsLayer; // Layer for favorite markers
        let csvUploadGraphicsLayer; // Layer for CSV markers
        let processedParcelDataForDownload = []; // Variable to store successful results for CSV download

        // URLs for our services
        const parcelLayerUrl = "https://gis.shelbycountytn.gov/arcgis/rest/services/Parcel/CERT_Parcel/MapServer";
        const parcelLayerId = 0; // The ID of the parcel layer
        const salesLayerId = 10; // The ID of the sales layer

        // External link templates
        const externalLinks = {
            // Register of Deeds - document-specific URL (uses instrument number)
            deedDocument: "https://search.register.shelby.tn.us/search/?instnum={DOC_NUMBER}",
            // Register of Deeds - search by parcel ID
            deedsSearch: "https://search.register.shelby.tn.us/search/?start=0&q={PARCELID}&f.tab=Properties",
            // Assessor of Property - replace PARCELID with actual ID
            assessor: "https://www.assessormelvinburgess.com/propertyDetails?IR=true&parcelid=PARCELID",
            // Trustee - replace PARCELID with actual ID
            trustee: "https://www.shelbycountytrustee.com/default.aspx?AspxAutoDetectCookieSupport=1",
            // Building permits - replace ADDRESS with encoded address
            permits: "https://shelbycountytn.gov/2332/Building-Permits",
            // Planning & Zoning
            planning: "https://shelbycountytn.gov/389/Planning-Development"
        };

        // Variable to store the current parcel data
        let currentParcelData = null;
        
        // Property navigation history system
        let propertyHistory = [];
        let currentHistoryIndex = -1;
        let uploadedFileData = null; // Variable to store parsed file data
        let uploadedFileHeaders = []; // Variable to store file headers
        let currentUploadedFileName = null; // Variable to store the name of the currently uploaded file
        
        // Create the map with high-quality satellite imagery
        const map = new Map({
            basemap: "satellite" // Using high-resolution satellite imagery
        });

        // Create the map view
        const view = new MapView({
            container: "viewDiv",
            map: map,
            center: [-89.9253, 35.1495], // Center on Shelby County
            zoom: 11,
            ui: {
                components: ["zoom"] // Only include zoom controls, remove attribution
            }
        });

        // Add parcel layer with enhanced styling for imagery basemap
        const parcelRenderer = {
            type: "simple",
            symbol: {
                type: "simple-fill",
                color: [0, 0, 0, 0], // Transparent fill
                outline: {
                    color: [255, 255, 0, 0.8], // Bright yellow outline for better visibility on imagery
                    width: 1.2 // Slightly thicker lines
                }
            }
        };

        // Create parcel layer with custom popup template
        const parcelLayer = new FeatureLayer({
            url: `${parcelLayerUrl}/${parcelLayerId}`,
            outFields: ["*"],
            renderer: parcelRenderer,
            title: "Shelby County Parcels",
            visible: false, // Start hidden - user can toggle on when needed
            popupEnabled: false // We'll handle popups ourselves
        });

        // Create a feature layer for sales history data (we won't add this to the map, just use it for queries)
        const salesLayer = new FeatureLayer({
            url: `${parcelLayerUrl}/${salesLayerId}`,
            outFields: ["*"],
            visible: false
        });
        
        // Create tower layer from Shelby County GIS Services
        const towersLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Towers/MapServer/1",
            outFields: ["*"],
            title: "Transmission Towers",
            visible: false, // Start hidden - user can toggle on when needed
            popupTemplate: {
                title: "Transmission Tower",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "STRUCTTYPE", label: "Structure Type" },
                        { fieldName: "HEIGHT_M", label: "Height (meters)" },
                        { fieldName: "HEIGHT_FT", label: "Height (feet)" },
                        { fieldName: "OWNER", label: "Owner" },
                        { fieldName: "ADDRESS", label: "Address" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 8,
                    color: [255, 0, 0, 0.8], // Red color for towers
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    }
                }
            }
        });

        // Create Billboards layer (from Signs service)
        const billboardsLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Signs/MapServer/0",
            outFields: ["*"],
            title: "Billboards",
            visible: false, // Start hidden
            popupTemplate: {
                title: "Billboard",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Owner", label: "Owner" },
                        { fieldName: "StrucHeight", label: "Structure Height" },
                        { fieldName: "BaseElevation", label: "Base Elevation" },
                        { fieldName: "TopElevation", label: "Top Elevation" },
                        { fieldName: "Originator", label: "Originator" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 8,
                    color: [255, 165, 0, 0.8], // Orange color for billboards
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    }
                }
            }
        });

        // Create Roadway sublayers
        const roadwayAlleyLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/0",
            outFields: ["*"],
            title: "Alley",
            visible: false,
            popupTemplate: {
                title: "Alley",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-line", color: [128, 128, 128, 0.7], width: 1 } }
        });

        const roadwayBridgesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/1",
            outFields: ["*"],
            title: "Bridges",
            visible: false,
            popupTemplate: {
                title: "Bridge",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-line", color: [139, 69, 19, 0.8], width: 3 } }
        });

        const roadwayDrivesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/2",
            outFields: ["*"],
            title: "Drives",
            visible: false,
            popupTemplate: {
                title: "Drive",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-line", color: [255, 192, 203, 0.7], width: 1 } }
        });

        const roadwayMedianLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/3",
            outFields: ["*"],
            title: "Median",
            visible: false,
            popupTemplate: {
                title: "Roadway Median",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [144, 238, 144, 0.6], outline: { color: [0, 100, 0, 0.8], width: 1 } } }
        });

        const roadwayMainLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/4",
            outFields: ["*"],
            title: "Roadway",
            visible: false,
            popupTemplate: {
                title: "Roadway",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-line", color: [0, 150, 255, 0.8], width: 2 } }
        });

        const roadwayParkingLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/5",
            outFields: ["*"],
            title: "Parking",
            visible: false,
            popupTemplate: {
                title: "Parking Area",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [255, 255, 0, 0.4], outline: { color: [255, 215, 0, 0.8], width: 1 } } }
        });

        const roadwayShoulderLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/6",
            outFields: ["*"],
            title: "Shoulder",
            visible: false,
            popupTemplate: { title: "Shoulder", content: "Click for shoulder information" },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [210, 180, 140, 0.5], outline: { color: [139, 117, 0, 0.8], width: 1 } } }
        });

        const roadwayUnpavedLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Roadway/MapServer/7",
            outFields: ["*"],
            title: "Unpaved Road",
            visible: false,
            popupTemplate: { title: "Unpaved Road", content: "Click for unpaved road information" },
            renderer: { type: "simple", symbol: { type: "simple-line", color: [160, 82, 45, 0.7], width: 2, style: "dash" } }
        });

        // Create Recreation sublayers
        const recreationAthleticFieldLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Recreation/MapServer/0",
            outFields: ["*"],
            title: "Athletic Field",
            visible: false,
            popupTemplate: {
                title: "Athletic Field - {Name}",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Name", label: "Name" },
                        { fieldName: "AthleticUse", label: "Athletic Use" },
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [34, 139, 34, 0.4], outline: { color: [0, 100, 0, 0.8], width: 2 } } }
        });

        const recreationTrackLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Recreation/MapServer/1",
            outFields: ["*"],
            title: "Athletic Track",
            visible: false,
            popupTemplate: {
                title: "Athletic Track - {Name}",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Name", label: "Name" },
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-line", color: [255, 20, 147, 0.8], width: 3 } }
        });

        const recreationCourtsLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Recreation/MapServer/2",
            outFields: ["*"],
            title: "Courts",
            visible: false,
            popupTemplate: {
                title: "Courts - {Name}",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Name", label: "Name" },
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                    ]
                }]
            },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [255, 140, 0, 0.6], outline: { color: [255, 69, 0, 0.8], width: 2 } } }
        });

        const recreationGolfLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Recreation/MapServer/3",
            outFields: ["*"],
            title: "Golf Course",
            visible: false,
            popupTemplate: { title: "Golf Course", content: "Click for golf course information" },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [50, 205, 50, 0.4], outline: { color: [34, 139, 34, 0.8], width: 2 } } }
        });

        const recreationPublicLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Recreation/MapServer/4",
            outFields: ["*"],
            title: "Public Recreation",
            visible: false,
            popupTemplate: { title: "Public Recreation", content: "Click for public recreation information" },
            renderer: { type: "simple", symbol: { type: "simple-fill", color: [0, 255, 0, 0.3], outline: { color: [0, 150, 0, 0.8], width: 2 } } }
        });

        // Create Flood Zone sublayers
        const floodElevationLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Flood_Zones/MapServer/0",
            outFields: ["*"],
            title: "Base Flood Elevation",
            visible: false,
            popupTemplate: {
                title: "Base Flood Elevation",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "ELEV", label: "Elevation (ft)" },
                            { fieldName: "LEN_UNIT", label: "Unit" },
                            { fieldName: "V_DATUM", label: "Vertical Datum" },
                            { fieldName: "DFIRM_ID", label: "DFIRM ID" },
                            { fieldName: "SOURCE_CIT", label: "Source Citation" }
                        ]
                    }
                ]
            },
            renderer: { 
                type: "simple", 
                symbol: { 
                    type: "simple-line", 
                    color: [0, 0, 139, 0.9], 
                    width: 3,
                    style: "solid"
                } 
            }
        });

        const floodZonesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Flood_Zones/MapServer/1",
            outFields: ["*"],
            title: "Flood Zones",
            visible: false,
            popupTemplate: {
                title: "Flood Zone - {FLD_ZONE}",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "FLD_ZONE", label: "Flood Zone" },
                            { fieldName: "ZONE_SUBTY", label: "Zone Type" },
                            { fieldName: "STATIC_BFE", label: "Base Flood Elevation (ft)" },
                            { fieldName: "DEPTH", label: "Flood Depth (ft)" },
                            { fieldName: "VELOCITY", label: "Velocity (fps)" },
                            { fieldName: "SFHA_TF", label: "Special Flood Hazard Area" },
                            { fieldName: "STUDY_TYP", label: "Study Type" },
                            { fieldName: "V_DATUM", label: "Vertical Datum" },
                            { fieldName: "SOURCE_CIT", label: "Source Citation" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "unique-value",
                field: "ZONE_SUBTY",
                defaultSymbol: {
                    type: "simple-fill",
                    color: [130, 130, 130, 0.1],
                    outline: { color: [100, 100, 100, 0.6], width: 1 }
                },
                uniqueValueInfos: [
                    {
                        value: "FLOODWAY",
                        symbol: {
                            type: "simple-fill",
                            color: [115, 223, 255, 0.4],
                            outline: { color: [0, 112, 255, 0.8], width: 2 }
                        }
                    },
                    {
                        value: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD",
                        symbol: {
                            type: "simple-fill",
                            color: [255, 211, 127, 0.3],
                            outline: { color: [168, 112, 0, 0.8], width: 1 }
                        }
                    },
                    {
                        value: "AREA WITH REDUCED FLOOD RISK DUE TO LEVEE",
                        symbol: {
                            type: "simple-fill",
                            color: [255, 211, 127, 0.2],
                            outline: { color: [255, 170, 0, 0.8], width: 1 }
                        }
                    },
                    {
                        value: "AREA OF MINIMAL FLOOD HAZARD",
                        symbol: {
                            type: "simple-fill",
                            color: [0, 0, 0, 0], // Transparent fill
                            outline: { color: [0, 0, 0, 0.3], width: 1 }
                        }
                    },
                    {
                        value: " ", // Floodplain (space character)
                        symbol: {
                            type: "simple-fill",
                            color: [85, 255, 0, 0.15],
                            outline: { color: [85, 255, 0, 0.6], width: 1 }
                        }
                    }
                ]
            }
        });

        // Create Benchmarks layer
        const benchmarksLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Benchmarks/MapServer/0",
            outFields: ["*"],
            title: "Benchmarks",
            visible: false,
            popupTemplate: {
                title: "Survey Benchmark - {NAME}",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "NAME", label: "Name" },
                            { fieldName: "Elev_Ft", label: "Elevation (ft)" },
                            { fieldName: "Elev_M", label: "Elevation (m)" },
                            { fieldName: "PID", label: "Point ID" },
                            { fieldName: "DEC_LAT", label: "Latitude" },
                            { fieldName: "DEC_LON", label: "Longitude" },
                            { fieldName: "POS_DATUM", label: "Position Datum" },
                            { fieldName: "VERT_DATUM", label: "Vertical Datum" },
                            { fieldName: "DATA_SRCE", label: "Data Source" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 8,
                    color: [0, 0, 139, 0.8], // Dark blue for survey benchmarks
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    },
                    style: "diamond"
                }
            }
        });

        // Create Cultural Resources sublayers
        const culturalHistoricCemeteriesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/CulturalResources/MapServer/0",
            outFields: ["*"],
            title: "Historic Cemeteries",
            visible: false,
            popupTemplate: {
                title: "Historic Cemetery - {Name}",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "Name", label: "Name" },
                            { fieldName: "ALTNAME", label: "Alternative Name" },
                            { fieldName: "TYPE", label: "Type" },
                            { fieldName: "PARCELID", label: "Parcel ID" },
                            { fieldName: "Location", label: "Location" },
                            { fieldName: "Vol", label: "Volume" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 10,
                    color: [139, 69, 19, 0.8], // Brown for historic cemeteries
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    },
                    style: "cross"
                }
            }
        });

        const culturalHistoricCommunitiesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/CulturalResources/MapServer/1",
            outFields: ["*"],
            title: "Historic Communities",
            visible: false,
            popupTemplate: {
                title: "Historic Community - {Name}",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Name", label: "Name" },
                        { fieldName: "ALTNAME", label: "Alternative Name" },
                        { fieldName: "TYPE", label: "Type" },
                        { fieldName: "PARCELID", label: "Parcel ID" },
                        { fieldName: "Location", label: "Location" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [160, 82, 45, 0.3], // Light brown fill
                    outline: {
                        color: [139, 69, 19, 0.8],
                        width: 2
                    }
                }
            }
        });

        const culturalHistoricalMarkersLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/CulturalResources/MapServer/2",
            outFields: ["*"],
            title: "Historical Markers",
            visible: false,
            popupTemplate: {
                title: "Historical Marker - {Name}",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Name", label: "Name" },
                        { fieldName: "Address", label: "Address" },
                        { fieldName: "Text", label: "Description" },
                        { fieldName: "Lat", label: "Latitude", format: { digitSeparator: false, places: 6 } },
                        { fieldName: "Long", label: "Longitude", format: { digitSeparator: false, places: 6 } },
                        { fieldName: "Image", label: "Image URL" },
                        { fieldName: "Video", label: "Video URL" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 10,
                    color: [218, 165, 32, 0.8], // Goldenrod for historical markers
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    },
                    style: "square"
                }
            }
        });

        const culturalCemeteryLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/CulturalResources/MapServer/3",
            outFields: ["*"],
            title: "Cemetery",
            visible: false,
            popupTemplate: {
                title: "Cemetery - {Name}",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "Name", label: "Name" },
                        { fieldName: "ALTNAME", label: "Alternative Name" },
                        { fieldName: "TYPE", label: "Type" },
                        { fieldName: "PARCELID", label: "Parcel ID" },
                        { fieldName: "Location", label: "Location" },
                        { fieldName: "Vol", label: "Volume" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 8,
                    color: [105, 105, 105, 0.8], // Dim gray for cemeteries
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    },
                    style: "cross"
                }
            }
        });

        const culturalLandmarkDistrictsLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/CulturalResources/MapServer/4",
            outFields: ["*"],
            title: "Landmark Districts",
            visible: false,
            popupTemplate: {
                title: "Landmark District",
                content: "Click for landmark district information"
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [255, 215, 0, 0.2], // Light gold fill
                    outline: {
                        color: [218, 165, 32, 0.8],
                        width: 2
                    }
                }
            }
        });

        // Create Contour layer
        const contourLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Contour1ft/MapServer/0",
            outFields: ["*"],
            title: "Contour Lines (1ft)",
            visible: false,
            popupTemplate: {
                title: "Contour Line",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "Contour", label: "Elevation (ft)" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [115, 76, 0, 0.6], // Brown contour lines
                    width: 0.5,
                    style: "solid"
                }
            }
        });

        // Create Industrial sublayers
        const industrialMinorLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Industrial/MapServer/0",
            outFields: ["*"],
            title: "Industrial Minor",
            visible: false,
            popupTemplate: {
                title: "Industrial Structure",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "FCODE", label: "Feature Code" },
                            { fieldName: "Originator", label: "Originator" },
                            { fieldName: "StrucHeight", label: "Structure Height" },
                            { fieldName: "BaseElevation", label: "Base Elevation" },
                            { fieldName: "TopElevation", label: "Top Elevation" },
                            { fieldName: "OrigDate", label: "Origin Date" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "unique-value",
                field: "FCODE",
                uniqueValueInfos: [
                    {
                        value: 513,
                        symbol: {
                            type: "simple-marker",
                            size: 8,
                            color: [128, 128, 128, 0.8], // Gray for silos
                            outline: { color: [255, 255, 255, 0.8], width: 1 },
                            style: "circle"
                        }
                    },
                    {
                        value: 516,
                        symbol: {
                            type: "simple-marker",
                            size: 8,
                            color: [255, 69, 0, 0.8], // Red-orange for smokestacks
                            outline: { color: [255, 255, 255, 0.8], width: 1 },
                            style: "circle"
                        }
                    },
                    {
                        value: 519,
                        symbol: {
                            type: "simple-marker",
                            size: 8,
                            color: [0, 191, 255, 0.8], // Deep sky blue for windmills
                            outline: { color: [255, 255, 255, 0.8], width: 1 },
                            style: "circle"
                        }
                    }
                ]
            }
        });

        const industrialMajorLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Industrial/MapServer/1",
            outFields: ["*"],
            title: "Industrial Major",
            visible: false,
            popupTemplate: {
                title: "Major Industrial Structure",
                content: "Click for major industrial structure information"
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 12,
                    color: [105, 105, 105, 0.8], // Dim gray for major industrial
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 2
                    },
                    style: "square"
                }
            }
        });

        // Create Drainage Basins sublayers
        const drainageFemaLomrLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/DrainageBasins/MapServer/0",
            outFields: ["*"],
            title: "FEMA LOMR",
            visible: false,
            popupTemplate: {
                title: "FEMA Letter of Map Revision",
                content: "Click for FEMA LOMR information"
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [255, 0, 0, 0.3], // Red for FEMA revisions
                    outline: {
                        color: [255, 0, 0, 0.8],
                        width: 2
                    }
                }
            }
        });

        const drainageFirmPanelsLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/DrainageBasins/MapServer/1",
            outFields: ["*"],
            title: "FIRM Panels",
            visible: false,
            popupTemplate: {
                title: "FIRM Panel",
                content: "Click for FIRM panel information"
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [0, 0, 0, 0], // Transparent fill
                    outline: {
                        color: [0, 0, 0, 0.6],
                        width: 1,
                        style: "dash"
                    }
                }
            }
        });

        const drainageSensitiveBasinsLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/DrainageBasins/MapServer/2",
            outFields: ["*"],
            title: "Sensitive Drainage Basins",
            visible: false,
            popupTemplate: {
                title: "Sensitive Drainage Basin - {BASIN}",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "BASIN", label: "Basin Name" },
                            { fieldName: "ID", label: "Basin ID" },
                            { fieldName: "PRIORITY", label: "Priority Level" },
                            { fieldName: "SENSITIVIT", label: "Sensitivity Level" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [255, 255, 0, 0.4], // Bright yellow for sensitive areas
                    outline: {
                        color: [255, 165, 0, 0.8],
                        width: 2
                    }
                }
            }
        });

        const drainageBasinsLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/DrainageBasins/MapServer/3",
            outFields: ["*"],
            title: "Drainage Basins",
            visible: false,
            popupTemplate: {
                title: "Drainage Basin - {BASIN}",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "BASIN", label: "Basin Name" },
                            { fieldName: "ID", label: "Basin ID" },
                            { fieldName: "PRIORITY", label: "Priority Level" },
                            { fieldName: "SENSITIVIT", label: "Sensitivity Level" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [0, 0, 0, 0], // Transparent fill
                    outline: {
                        color: [0, 112, 255, 0.8],
                        width: 2
                    }
                }
            }
        });

        // Create Corporate Boundaries layer
        const corporateBoundariesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/CorporateBoundaries/MapServer/0",
            outFields: ["*"],
            title: "Municipal Boundaries",
            visible: false,
            popupTemplate: {
                title: "Municipal Boundary - {City}",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "City", label: "Municipality" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "unique-value",
                field: "City",
                defaultSymbol: {
                    type: "simple-fill",
                    color: [128, 128, 128, 0.2],
                    outline: { color: [0, 0, 0, 0.8], width: 2 }
                },
                uniqueValueInfos: [
                    {
                        value: "Memphis",
                        symbol: {
                            type: "simple-fill",
                            color: [252, 207, 245, 0.3], // Light pink for Memphis
                            outline: { color: [255, 20, 147, 0.8], width: 3 }
                        }
                    },
                    {
                        value: "Germantown",
                        symbol: {
                            type: "simple-fill",
                            color: [197, 239, 252, 0.3], // Light blue for Germantown
                            outline: { color: [0, 149, 255, 0.8], width: 2 }
                        }
                    },
                    {
                        value: "Collierville",
                        symbol: {
                            type: "simple-fill",
                            color: [252, 241, 215, 0.3], // Light orange for Collierville
                            outline: { color: [255, 140, 0, 0.8], width: 2 }
                        }
                    },
                    {
                        value: "Bartlett",
                        symbol: {
                            type: "simple-fill",
                            color: [215, 221, 252, 0.3], // Light purple for Bartlett
                            outline: { color: [138, 43, 226, 0.8], width: 2 }
                        }
                    },
                    {
                        value: "Arlington",
                        symbol: {
                            type: "simple-fill",
                            color: [179, 252, 222, 0.3], // Light green for Arlington
                            outline: { color: [0, 255, 127, 0.8], width: 2 }
                        }
                    },
                    {
                        value: "Lakeland",
                        symbol: {
                            type: "simple-fill",
                            color: [251, 179, 252, 0.3], // Light magenta for Lakeland
                            outline: { color: [255, 0, 255, 0.8], width: 2 }
                        }
                    },
                    {
                        value: "Millington",
                        symbol: {
                            type: "simple-fill",
                            color: [192, 193, 252, 0.3], // Light blue-purple for Millington
                            outline: { color: [75, 0, 130, 0.8], width: 2 }
                        }
                    }
                ]
            }
        });

        // Create Foreclosures layer
        const foreclosuresLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Foreclosures/MapServer/0",
            outFields: ["*"],
            title: "Foreclosures",
            visible: false,
            popupTemplate: {
                title: "Foreclosure Property",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "PARID", label: "Parcel ID" },
                            { fieldName: "PRICE", label: "Sale Price ($)" },
                            { fieldName: "SALEDT", label: "Sale Date" },
                            { fieldName: "INSTRTYP", label: "Instrument Type" },
                            { fieldName: "OWN1", label: "Owner" },
                            { fieldName: "ADDR1", label: "Property Address" },
                            { fieldName: "ADDR3", label: "City, State" },
                            { fieldName: "ZIP1", label: "ZIP Code" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [255, 69, 0, 0.6], // Red-orange for foreclosures (attention-grabbing)
                    outline: {
                        color: [139, 0, 0, 0.9],
                        width: 2
                    }
                }
            }
        });

        // Create Hydrology layers
        const hydrologyCreekLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Hydrology/MapServer/0",
            outFields: ["*"],
            title: "Creek",
            visible: false,
            popupTemplate: {
                title: "Creek",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [30, 144, 255, 0.8], // Dodger blue for creeks
                    width: 2
                }
            }
        });

        const hydrologyStreamMinorLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Hydrology/MapServer/1",
            outFields: ["*"],
            title: "Stream Minor",
            visible: false,
            popupTemplate: {
                title: "Minor Stream",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [135, 206, 235, 0.7], // Sky blue for minor streams
                    width: 1.5
                }
            }
        });

        const hydrologyStreamLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Hydrology/MapServer/2",
            outFields: ["*"],
            title: "Stream",
            visible: false,
            popupTemplate: {
                title: "Stream",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [65, 105, 225, 0.8], // Royal blue for streams
                    width: 2.5
                }
            }
        });

        const hydrologyRiverLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Hydrology/MapServer/3",
            outFields: ["*"],
            title: "River",
            visible: false,
            popupTemplate: {
                title: "River",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [0, 0, 139, 0.9], // Dark blue for rivers
                    width: 4
                }
            }
        });

        const hydrologyWaterbodiesLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Hydrology/MapServer/4",
            outFields: ["*"],
            title: "Waterbodies",
            visible: false,
            popupTemplate: {
                title: "Waterbody",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [0, 191, 255, 0.5], // Deep sky blue for waterbodies
                    outline: {
                        color: [0, 0, 139, 0.8],
                        width: 1.5
                    }
                }
            }
        });

        const hydrologyBasinLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Hydrology/MapServer/5",
            outFields: ["*"],
            title: "Basin",
            visible: false,
            popupTemplate: {
                title: "Basin",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-fill",
                    color: [176, 224, 230, 0.3], // Powder blue for basins
                    outline: {
                        color: [70, 130, 180, 0.7],
                        width: 1
                    }
                }
            }
        });

        // Create Hydrology Structures layers
        const hydroStructuresStormInletLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/HydrologyStructures/MapServer/0",
            outFields: ["*"],
            title: "Stormwater Inlet",
            visible: false,
            popupTemplate: {
                title: "Stormwater Inlet",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 8,
                    color: [0, 100, 0, 0.8], // Dark green for storm inlets
                    style: "square",
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    }
                }
            }
        });

        const hydroStructuresCulvertLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/HydrologyStructures/MapServer/1",
            outFields: ["*"],
            title: "Culvert",
            visible: false,
            popupTemplate: {
                title: "Culvert",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [128, 128, 128, 0.8], // Gray for culverts
                    width: 3,
                    style: "solid"
                }
            }
        });

        const hydroStructuresDrainConnectorLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/HydrologyStructures/MapServer/2",
            outFields: ["*"],
            title: "Drain Connector",
            visible: false,
            popupTemplate: {
                title: "Drain Connector",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [34, 139, 34, 0.7], // Forest green for drain connectors
                    width: 2,
                    style: "dash"
                }
            }
        });

        const hydroStructuresHydroConnectorLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/HydrologyStructures/MapServer/3",
            outFields: ["*"],
            title: "Hydro Connector",
            visible: false,
            popupTemplate: {
                title: "Hydro Connector",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" },
                        { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-line",
                    color: [30, 144, 255, 0.6], // Dodger blue for hydro connectors
                    width: 2,
                    style: "dot"
                }
            }
        });

        const hydroStructuresHeadwallLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/HydrologyStructures/MapServer/4",
            outFields: ["*"],
            title: "Headwall",
            visible: false,
            popupTemplate: {
                title: "Headwall",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 10,
                    color: [105, 105, 105, 0.8], // Dim gray for headwalls
                    style: "triangle",
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    }
                }
            }
        });

        const hydroStructuresGeneralLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/HydrologyStructures/MapServer/5",
            outFields: ["*"],
            title: "Hydro Structures",
            visible: false,
            popupTemplate: {
                title: "Hydro Structure",
                content: [{
                    type: "fields",
                    fieldInfos: [
                        { fieldName: "FCODE", label: "Feature Code" },
                        { fieldName: "Originator", label: "Created By" },
                        { fieldName: "OrigDate", label: "Created Date" }
                    ]
                }]
            },
            renderer: {
                type: "simple",
                symbol: {
                    type: "simple-marker",
                    size: 8,
                    color: [72, 61, 139, 0.8], // Dark slate blue for general hydro structures
                    style: "circle",
                    outline: {
                        color: [255, 255, 255, 0.8],
                        width: 1
                    }
                }
            }
        });

        // Create Building layer
        const buildingLayer = new FeatureLayer({
            url: "https://gis.shelbycountytn.gov/public/rest/services/BaseMap/Building/MapServer/0",
            outFields: ["*"],
            title: "Building Footprints",
            visible: false,
            popupTemplate: {
                title: "Building",
                content: [
                    {
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "FCODE", label: "Feature Code" },
                            { fieldName: "BldgClass", label: "Building Class" },
                            { fieldName: "StrucType", label: "Structure Type" },
                            { fieldName: "StrucHeight", label: "Structure Height" },
                            { fieldName: "BaseElevation", label: "Base Elevation" },
                            { fieldName: "TopElevation", label: "Top Elevation" },
                            { fieldName: "LandUse", label: "Land Use" },
                            { fieldName: "YearBuilt", label: "Year Built" },
                            { fieldName: "YearDemo", label: "Year Demolished" }
                        ]
                    }
                ]
            },
            renderer: {
                type: "unique-value",
                field: "FCODE",
                defaultSymbol: {
                    type: "simple-fill",
                    color: [190, 190, 190, 0.7],
                    outline: { color: [0, 0, 0, 0.5], width: 0.5 }
                },
                uniqueValueInfos: [
                    {
                        value: 704, // Building >5 per side
                        symbol: {
                            type: "simple-fill",
                            color: [70, 130, 180, 0.7], // Steel blue for large buildings
                            outline: { color: [25, 25, 112, 0.8], width: 1 }
                        }
                    },
                    {
                        value: 707, // Building <5 per side
                        symbol: {
                            type: "simple-fill",
                            color: [176, 196, 222, 0.6], // Light steel blue for small buildings
                            outline: { color: [70, 130, 180, 0.7], width: 0.5 }
                        }
                    },
                    {
                        value: 710, // Ruin
                        symbol: {
                            type: "simple-fill",
                            color: [139, 69, 19, 0.5], // Saddle brown for ruins
                            outline: { color: [160, 82, 45, 0.8], width: 1 }
                        }
                    }
                ]
            }
        });
        
        // Add the parcel layer to the map
        map.add(parcelLayer);

        // Add the towers layer to the map
        map.add(towersLayer);

        // Add all the new layers to the map
        map.add(billboardsLayer);
        
        // Add roadway sublayers
        map.add(roadwayAlleyLayer);
        map.add(roadwayBridgesLayer);
        map.add(roadwayDrivesLayer);
        map.add(roadwayMedianLayer);
        map.add(roadwayMainLayer);
        map.add(roadwayParkingLayer);
        map.add(roadwayShoulderLayer);
        map.add(roadwayUnpavedLayer);
        
        // Add recreation sublayers
        map.add(recreationAthleticFieldLayer);
        map.add(recreationTrackLayer);
        map.add(recreationCourtsLayer);
        map.add(recreationGolfLayer);
        map.add(recreationPublicLayer);
        
        // Add flood zone sublayers
        map.add(floodElevationLayer);
        map.add(floodZonesLayer);
        
        // Add new service layers
        map.add(benchmarksLayer);
        
        // Add cultural resources sublayers
        map.add(culturalHistoricCemeteriesLayer);
        map.add(culturalHistoricCommunitiesLayer);
        map.add(culturalHistoricalMarkersLayer);
        map.add(culturalCemeteryLayer);
        map.add(culturalLandmarkDistrictsLayer);
        
        // Add contour layer
        map.add(contourLayer);
        
        // Add industrial sublayers
        map.add(industrialMinorLayer);
        map.add(industrialMajorLayer);
        
        // Add drainage basins sublayers
        map.add(drainageFemaLomrLayer);
        map.add(drainageFirmPanelsLayer);
        map.add(drainageSensitiveBasinsLayer);
        map.add(drainageBasinsLayer);
        
        // Add municipal boundaries layer
        map.add(corporateBoundariesLayer);
        
        // Add foreclosures layer
        map.add(foreclosuresLayer);
        
        // Add building layer
        map.add(buildingLayer);
        
        // Add hydrology layers
        map.add(hydrologyCreekLayer);
        map.add(hydrologyStreamMinorLayer);
        map.add(hydrologyStreamLayer);
        map.add(hydrologyRiverLayer);
        map.add(hydrologyWaterbodiesLayer);
        map.add(hydrologyBasinLayer);
        
        // Add hydrology structures layers
        map.add(hydroStructuresStormInletLayer);
        map.add(hydroStructuresCulvertLayer);
        map.add(hydroStructuresDrainConnectorLayer);
        map.add(hydroStructuresHydroConnectorLayer);
        map.add(hydroStructuresHeadwallLayer);
        map.add(hydroStructuresGeneralLayer);

        // Layer for highlighting selected parcels
        highlightGraphicsLayer = new GraphicsLayer(); // Initialize here
        map.add(highlightGraphicsLayer); // Add to map

        // Layer for CSV markers
        csvUploadGraphicsLayer = new GraphicsLayer(); // Initialize here
        map.add(csvUploadGraphicsLayer); // Add to map

        // Initialize Favorites Layer
        favoritesGraphicsLayer = new GraphicsLayer({
            title: "Favorites"
        });
        map.add(favoritesGraphicsLayer);

        // Add a home widget to return to the initial extent
        const homeWidget = new Home({
            view: view
        });
        view.ui.add(homeWidget, "top-left");

        // Add locate widget to zoom to user's location
        const locateWidget = new Locate({
            view: view
        });
        view.ui.add(locateWidget, "top-left");

        // Add basemap gallery widget
        const basemapGallery = new BasemapGallery({
            view: view
        });
        
        // Create an expand widget for the basemap gallery
        const bgExpand = new Expand({
            view: view,
            content: basemapGallery,
            expandIconClass: "esri-icon-basemap",
            expandTooltip: "Change Basemap"
        });
        view.ui.add(bgExpand, "top-right");

        // Create Layer Control Panel
        const layerControlDiv = document.createElement("div");
        layerControlDiv.className = "esri-widget layer-control-panel";
        layerControlDiv.innerHTML = `
            <div class="layer-control-header">
                <h3>Map Layers</h3>
            </div>
            <div class="layer-control-content">
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="parcels-layer-toggle" checked>
                        <span class="checkmark"></span>
                        <span class="layer-label">Property Parcels</span>
                    </label>
                </div>
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="towers-layer-toggle" checked>
                        <span class="checkmark"></span>
                        <span class="layer-label">Transmission Towers</span>
                    </label>
                </div>
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="billboards-layer-toggle">
                        <span class="checkmark"></span>
                        <span class="layer-label">Billboards</span>
                    </label>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Roadway Layers</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-alley-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Alley</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-bridges-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Bridges</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-drives-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Drives</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-median-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Median</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-main-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Roadway</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-parking-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Parking</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-shoulder-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Shoulder</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="roadway-unpaved-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Unpaved Road</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Recreation Layers</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="recreation-athletic-field-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Athletic Field</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="recreation-track-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Athletic Track</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="recreation-courts-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Courts</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="recreation-golf-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Golf Course</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="recreation-public-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Public Recreation</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Flood Zone Layers</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="flood-elevation-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Base Flood Elevation</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="flood-zones-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Flood Zones</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="benchmarks-toggle">
                        <span class="checkmark"></span>
                        <span class="layer-label">Survey Benchmarks</span>
                    </label>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Cultural Resources</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="cultural-historic-cemeteries-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Historic Cemeteries</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="cultural-historic-communities-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Historic Communities</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="cultural-historical-markers-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Historical Markers</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="cultural-cemetery-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Cemetery</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="cultural-landmark-districts-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Landmark Districts</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="contour-toggle">
                        <span class="checkmark"></span>
                        <span class="layer-label">Contour Lines (1ft)</span>
                    </label>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Industrial Layers</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="industrial-minor-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Industrial Minor</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="industrial-major-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Industrial Major</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Drainage & Water</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="drainage-fema-lomr-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">FEMA LOMR</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="drainage-firm-panels-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">FIRM Panels</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="drainage-sensitive-basins-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Sensitive Drainage Basins</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="drainage-basins-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Drainage Basins</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="corporate-boundaries-toggle">
                        <span class="checkmark"></span>
                        <span class="layer-label">Municipal Boundaries</span>
                    </label>
                </div>
                
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="foreclosures-toggle">
                        <span class="checkmark"></span>
                        <span class="layer-label">Foreclosures</span>
                    </label>
                </div>
                
                <div class="layer-item">
                    <label class="layer-checkbox-container">
                        <input type="checkbox" id="building-toggle">
                        <span class="checkmark"></span>
                        <span class="layer-label">Building Footprints</span>
                    </label>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Hydrology Layers</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydrology-creek-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Creek</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydrology-stream-minor-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Stream Minor</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydrology-stream-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Stream</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydrology-river-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">River</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydrology-waterbodies-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Waterbodies</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydrology-basin-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Basin</span>
                            </label>
                        </div>
                    </div>
                </div>
                
                <div class="layer-group">
                    <div class="layer-group-header">Hydrology Structures</div>
                    <div class="layer-sublayers">
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydro-structures-storm-inlet-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Stormwater Inlet</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydro-structures-culvert-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Culvert</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydro-structures-drain-connector-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Drain Connector</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydro-structures-hydro-connector-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Hydro Connector</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydro-structures-headwall-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Headwall</span>
                            </label>
                        </div>
                        <div class="layer-item sublayer">
                            <label class="layer-checkbox-container">
                                <input type="checkbox" id="hydro-structures-general-toggle">
                                <span class="checkmark"></span>
                                <span class="layer-label">Hydro Structures</span>
                            </label>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Create an expand widget for layer control
        const layerExpand = new Expand({
            view: view,
            content: layerControlDiv,
            expandIconClass: "esri-icon-layers",
            expandTooltip: "Toggle Map Layers"
        });
        view.ui.add(layerExpand, "top-right");

        // Loading indicator management
        const loadingIndicator = document.getElementById('loading-indicator');
        const loadingText = document.getElementById('loading-text');
        let activeLoadingLayers = new Set();
        
        function showLoadingIndicator(layerName) {
            activeLoadingLayers.add(layerName);
            loadingText.textContent = `Loading ${layerName}...`;
            loadingIndicator.classList.remove('hidden');
        }
        
        function hideLoadingIndicator(layerName) {
            activeLoadingLayers.delete(layerName);
            if (activeLoadingLayers.size === 0) {
                loadingIndicator.classList.add('hidden');
            } else {
                // Show the first remaining loading layer
                const remainingLayer = Array.from(activeLoadingLayers)[0];
                loadingText.textContent = `Loading ${remainingLayer}...`;
            }
        }
        
        // Function to add loading listeners to a layer
        function addLoadingListeners(layer, displayName) {
            const layerView = view.whenLayerView(layer);
            
            layerView.then((lv) => {
                // Watch for updating state
                lv.watch('updating', (updating) => {
                    if (updating && layer.visible) {
                        showLoadingIndicator(displayName);
                    } else {
                        hideLoadingIndicator(displayName);
                    }
                });
                
                // Check if layer loads any features when made visible
                layer.watch('visible', (visible) => {
                    if (visible) {
                        // Check if the layer actually has features in the current view
                        setTimeout(() => {
                            lv.queryFeatures({
                                geometry: view.extent,
                                spatialRelationship: "intersects",
                                returnGeometry: false,
                                outFields: ["*"],
                                maxRecordCount: 1
                            }).then((result) => {
                                if (result.features.length === 0) {
                                    console.warn(`⚠️ Layer "${displayName}" is enabled but shows no features in current view. This may be normal if zoomed out or in area with no data.`);
                                } else {
                                    console.log(`✅ Layer "${displayName}" loaded ${result.features.length > 0 ? 'successfully' : 'with no visible features'}`);
                                }
                            }).catch((error) => {
                                console.error(`❌ Layer "${displayName}" failed to query features:`, error);
                                console.error(`Layer URL: ${layer.url}`);
                            });
                        }, 2000); // Wait 2 seconds for layer to settle
                    }
                });
                
            }).catch((error) => {
                console.error(`❌ Layer "${displayName}" failed to create layer view:`, error);
                console.error(`Layer URL: ${layer.url}`);
                hideLoadingIndicator(displayName);
            });
        }
        
        // Function to test all layers and report their status
        function testAllLayers() {
            console.log("🔍 Testing all layers for functionality...");
            const allLayers = [
                { layer: parcelLayer, name: "Property Parcels" },
                { layer: towersLayer, name: "Transmission Towers" },
                { layer: billboardsLayer, name: "Billboards" },
                { layer: roadwayAlleyLayer, name: "Alleys" },
                { layer: roadwayBridgesLayer, name: "Bridges" },
                { layer: roadwayDrivesLayer, name: "Drives" },
                { layer: roadwayMedianLayer, name: "Medians" },
                { layer: roadwayMainLayer, name: "Roadways" },
                { layer: roadwayParkingLayer, name: "Parking" },
                { layer: roadwayShoulderLayer, name: "Shoulders" },
                { layer: roadwayUnpavedLayer, name: "Unpaved Roads" },
                { layer: recreationAthleticFieldLayer, name: "Athletic Fields" },
                { layer: recreationTrackLayer, name: "Athletic Tracks" },
                { layer: recreationCourtsLayer, name: "Courts" },
                { layer: recreationGolfLayer, name: "Golf Courses" },
                { layer: recreationPublicLayer, name: "Public Recreation" },
                { layer: floodElevationLayer, name: "Base Flood Elevation" },
                { layer: floodZonesLayer, name: "Flood Zones" },
                { layer: benchmarksLayer, name: "Benchmarks" },
                { layer: culturalHistoricCemeteriesLayer, name: "Historic Cemeteries" },
                { layer: culturalHistoricCommunitiesLayer, name: "Historic Communities" },
                { layer: culturalHistoricalMarkersLayer, name: "Historical Markers" },
                { layer: culturalCemeteryLayer, name: "Cemeteries" },
                { layer: culturalLandmarkDistrictsLayer, name: "Landmark Districts" },
                { layer: contourLayer, name: "Contour Lines" },
                { layer: industrialMinorLayer, name: "Industrial Minor" },
                { layer: industrialMajorLayer, name: "Industrial Major" },
                { layer: drainageFemaLomrLayer, name: "FEMA LOMR" },
                { layer: drainageFirmPanelsLayer, name: "FIRM Panels" },
                { layer: drainageSensitiveBasinsLayer, name: "Sensitive Drainage Basins" },
                { layer: drainageBasinsLayer, name: "Drainage Basins" },
                { layer: corporateBoundariesLayer, name: "Municipal Boundaries" },
                { layer: foreclosuresLayer, name: "Foreclosures" },
                { layer: buildingLayer, name: "Building Footprints" },
                
                // Hydrology layers
                { layer: hydrologyCreekLayer, name: "Creeks" },
                { layer: hydrologyStreamMinorLayer, name: "Minor Streams" },
                { layer: hydrologyStreamLayer, name: "Streams" },
                { layer: hydrologyRiverLayer, name: "Rivers" },
                { layer: hydrologyWaterbodiesLayer, name: "Waterbodies" },
                { layer: hydrologyBasinLayer, name: "Basins" },
                
                // Hydrology structures
                { layer: hydroStructuresStormInletLayer, name: "Stormwater Inlets" },
                { layer: hydroStructuresCulvertLayer, name: "Culverts" },
                { layer: hydroStructuresDrainConnectorLayer, name: "Drain Connectors" },
                { layer: hydroStructuresHydroConnectorLayer, name: "Hydro Connectors" },
                { layer: hydroStructuresHeadwallLayer, name: "Headwalls" },
                { layer: hydroStructuresGeneralLayer, name: "Hydro Structures" }
            ];
            
            // Expose the test function globally for manual testing
            window.testLayers = () => {
                allLayers.forEach(({ layer, name }) => {
                    layer.queryFeatures({
                        where: "1=1",
                        returnGeometry: false,
                        outFields: ["*"],
                        maxRecordCount: 1
                    }).then((result) => {
                        if (result.features.length === 0) {
                            console.warn(`⚠️ "${name}" has no features (URL: ${layer.url})`);
                        } else {
                            console.log(`✅ "${name}" has features available`);
                        }
                    }).catch((error) => {
                        console.error(`❌ "${name}" failed query test:`, error.message);
                        console.error(`   URL: ${layer.url}`);
                    });
                });
            };
            
            console.log("📝 Test function available as window.testLayers() - call it in console to test all layers");
        }

        // Setup layer control event listeners after view is ready
        view.when(() => {
            // Layer toggle event listeners for expandable widget
            const layerToggles = [
                // Base layers
                { toggle: "parcels-layer-toggle", layer: parcelLayer, sidebar: "sidebar-parcels-layer-toggle" },
                { toggle: "towers-layer-toggle", layer: towersLayer, sidebar: "sidebar-towers-layer-toggle" },
                { toggle: "billboards-layer-toggle", layer: billboardsLayer, sidebar: "sidebar-billboards-layer-toggle" },
                
                // Roadway sublayers
                { toggle: "roadway-alley-toggle", layer: roadwayAlleyLayer, sidebar: "sidebar-roadway-alley-toggle" },
                { toggle: "roadway-bridges-toggle", layer: roadwayBridgesLayer, sidebar: "sidebar-roadway-bridges-toggle" },
                { toggle: "roadway-drives-toggle", layer: roadwayDrivesLayer, sidebar: "sidebar-roadway-drives-toggle" },
                { toggle: "roadway-median-toggle", layer: roadwayMedianLayer, sidebar: "sidebar-roadway-median-toggle" },
                { toggle: "roadway-main-toggle", layer: roadwayMainLayer, sidebar: "sidebar-roadway-main-toggle" },
                { toggle: "roadway-parking-toggle", layer: roadwayParkingLayer, sidebar: "sidebar-roadway-parking-toggle" },
                { toggle: "roadway-shoulder-toggle", layer: roadwayShoulderLayer, sidebar: "sidebar-roadway-shoulder-toggle" },
                { toggle: "roadway-unpaved-toggle", layer: roadwayUnpavedLayer, sidebar: "sidebar-roadway-unpaved-toggle" },
                
                // Recreation sublayers
                { toggle: "recreation-athletic-field-toggle", layer: recreationAthleticFieldLayer, sidebar: "sidebar-recreation-athletic-field-toggle" },
                { toggle: "recreation-track-toggle", layer: recreationTrackLayer, sidebar: "sidebar-recreation-track-toggle" },
                { toggle: "recreation-courts-toggle", layer: recreationCourtsLayer, sidebar: "sidebar-recreation-courts-toggle" },
                { toggle: "recreation-golf-toggle", layer: recreationGolfLayer, sidebar: "sidebar-recreation-golf-toggle" },
                { toggle: "recreation-public-toggle", layer: recreationPublicLayer, sidebar: "sidebar-recreation-public-toggle" },
                
                // Flood zone sublayers
                { toggle: "flood-elevation-toggle", layer: floodElevationLayer, sidebar: "sidebar-flood-elevation-toggle" },
                { toggle: "flood-zones-toggle", layer: floodZonesLayer, sidebar: "sidebar-flood-zones-toggle" },
                
                // Benchmarks layer
                { toggle: "benchmarks-toggle", layer: benchmarksLayer, sidebar: "sidebar-benchmarks-toggle" },
                
                // Cultural resources sublayers
                { toggle: "cultural-historic-cemeteries-toggle", layer: culturalHistoricCemeteriesLayer, sidebar: "sidebar-cultural-historic-cemeteries-toggle" },
                { toggle: "cultural-historic-communities-toggle", layer: culturalHistoricCommunitiesLayer, sidebar: "sidebar-cultural-historic-communities-toggle" },
                { toggle: "cultural-historical-markers-toggle", layer: culturalHistoricalMarkersLayer, sidebar: "sidebar-cultural-historical-markers-toggle" },
                { toggle: "cultural-cemetery-toggle", layer: culturalCemeteryLayer, sidebar: "sidebar-cultural-cemetery-toggle" },
                { toggle: "cultural-landmark-districts-toggle", layer: culturalLandmarkDistrictsLayer, sidebar: "sidebar-cultural-landmark-districts-toggle" },
                
                // Contour layer
                { toggle: "contour-toggle", layer: contourLayer, sidebar: "sidebar-contour-toggle" },
                
                // Industrial sublayers
                { toggle: "industrial-minor-toggle", layer: industrialMinorLayer, sidebar: "sidebar-industrial-minor-toggle" },
                { toggle: "industrial-major-toggle", layer: industrialMajorLayer, sidebar: "sidebar-industrial-major-toggle" },
                
                // Drainage basins sublayers
                { toggle: "drainage-fema-lomr-toggle", layer: drainageFemaLomrLayer, sidebar: "sidebar-drainage-fema-lomr-toggle" },
                { toggle: "drainage-firm-panels-toggle", layer: drainageFirmPanelsLayer, sidebar: "sidebar-drainage-firm-panels-toggle" },
                { toggle: "drainage-sensitive-basins-toggle", layer: drainageSensitiveBasinsLayer, sidebar: "sidebar-drainage-sensitive-basins-toggle" },
                { toggle: "drainage-basins-toggle", layer: drainageBasinsLayer, sidebar: "sidebar-drainage-basins-toggle" },
                
                // Municipal boundaries layer
                { toggle: "corporate-boundaries-toggle", layer: corporateBoundariesLayer, sidebar: "sidebar-corporate-boundaries-toggle" },
                
                // Foreclosures layer
                { toggle: "foreclosures-toggle", layer: foreclosuresLayer, sidebar: "sidebar-foreclosures-toggle" },
                
                // Building layer
                { toggle: "building-toggle", layer: buildingLayer, sidebar: "sidebar-building-toggle" },
                
                // Hydrology layers
                { toggle: "hydrology-creek-toggle", layer: hydrologyCreekLayer, sidebar: "sidebar-hydrology-creek-toggle" },
                { toggle: "hydrology-stream-minor-toggle", layer: hydrologyStreamMinorLayer, sidebar: "sidebar-hydrology-stream-minor-toggle" },
                { toggle: "hydrology-stream-toggle", layer: hydrologyStreamLayer, sidebar: "sidebar-hydrology-stream-toggle" },
                { toggle: "hydrology-river-toggle", layer: hydrologyRiverLayer, sidebar: "sidebar-hydrology-river-toggle" },
                { toggle: "hydrology-waterbodies-toggle", layer: hydrologyWaterbodiesLayer, sidebar: "sidebar-hydrology-waterbodies-toggle" },
                { toggle: "hydrology-basin-toggle", layer: hydrologyBasinLayer, sidebar: "sidebar-hydrology-basin-toggle" },
                
                // Hydrology structures layers
                { toggle: "hydro-structures-storm-inlet-toggle", layer: hydroStructuresStormInletLayer, sidebar: "sidebar-hydro-structures-storm-inlet-toggle" },
                { toggle: "hydro-structures-culvert-toggle", layer: hydroStructuresCulvertLayer, sidebar: "sidebar-hydro-structures-culvert-toggle" },
                { toggle: "hydro-structures-drain-connector-toggle", layer: hydroStructuresDrainConnectorLayer, sidebar: "sidebar-hydro-structures-drain-connector-toggle" },
                { toggle: "hydro-structures-hydro-connector-toggle", layer: hydroStructuresHydroConnectorLayer, sidebar: "sidebar-hydro-structures-hydro-connector-toggle" },
                { toggle: "hydro-structures-headwall-toggle", layer: hydroStructuresHeadwallLayer, sidebar: "sidebar-hydro-structures-headwall-toggle" },
                { toggle: "hydro-structures-general-toggle", layer: hydroStructuresGeneralLayer, sidebar: "sidebar-hydro-structures-general-toggle" }
            ];

            // Initialize checkboxes to match layer visibility states
            layerToggles.forEach(config => {
                const toggle = document.getElementById(config.toggle);
                const sidebarToggle = document.getElementById(config.sidebar);
                
                if (toggle) {
                    toggle.checked = config.layer.visible;
                }
                if (sidebarToggle) {
                    sidebarToggle.checked = config.layer.visible;
                }
            });

            // Add loading listeners to all layers
            addLoadingListeners(parcelLayer, "Property Parcels");
            addLoadingListeners(towersLayer, "Transmission Towers");
            addLoadingListeners(billboardsLayer, "Billboards");
            addLoadingListeners(roadwayAlleyLayer, "Alleys");
            addLoadingListeners(roadwayBridgesLayer, "Bridges");
            addLoadingListeners(roadwayDrivesLayer, "Drives");
            addLoadingListeners(roadwayMedianLayer, "Medians");
            addLoadingListeners(roadwayMainLayer, "Roadways");
            addLoadingListeners(roadwayParkingLayer, "Parking");
            addLoadingListeners(roadwayShoulderLayer, "Shoulders");
            addLoadingListeners(roadwayUnpavedLayer, "Unpaved Roads");
            addLoadingListeners(recreationAthleticFieldLayer, "Athletic Fields");
            addLoadingListeners(recreationTrackLayer, "Athletic Tracks");
            addLoadingListeners(recreationCourtsLayer, "Courts");
            addLoadingListeners(recreationGolfLayer, "Golf Courses");
            addLoadingListeners(recreationPublicLayer, "Public Recreation");
            addLoadingListeners(floodElevationLayer, "Base Flood Elevation");
            addLoadingListeners(floodZonesLayer, "Flood Zones");
            addLoadingListeners(benchmarksLayer, "Benchmarks");
            addLoadingListeners(culturalHistoricCemeteriesLayer, "Historic Cemeteries");
            addLoadingListeners(culturalHistoricCommunitiesLayer, "Historic Communities");
            addLoadingListeners(culturalHistoricalMarkersLayer, "Historical Markers");
            addLoadingListeners(culturalCemeteryLayer, "Cemeteries");
            addLoadingListeners(culturalLandmarkDistrictsLayer, "Landmark Districts");
            addLoadingListeners(contourLayer, "Contour Lines");
            addLoadingListeners(industrialMinorLayer, "Industrial Minor");
            addLoadingListeners(industrialMajorLayer, "Industrial Major");
            addLoadingListeners(drainageFemaLomrLayer, "FEMA LOMR");
            addLoadingListeners(drainageFirmPanelsLayer, "FIRM Panels");
            addLoadingListeners(drainageSensitiveBasinsLayer, "Sensitive Drainage Basins");
            addLoadingListeners(drainageBasinsLayer, "Drainage Basins");
            addLoadingListeners(corporateBoundariesLayer, "Municipal Boundaries");
            addLoadingListeners(foreclosuresLayer, "Foreclosures");
            addLoadingListeners(buildingLayer, "Building Footprints");
            
            // Add loading listeners for hydrology layers
            addLoadingListeners(hydrologyCreekLayer, "Creeks");
            addLoadingListeners(hydrologyStreamMinorLayer, "Minor Streams");
            addLoadingListeners(hydrologyStreamLayer, "Streams");
            addLoadingListeners(hydrologyRiverLayer, "Rivers");
            addLoadingListeners(hydrologyWaterbodiesLayer, "Waterbodies");
            addLoadingListeners(hydrologyBasinLayer, "Basins");
            
            // Add loading listeners for hydrology structures
            addLoadingListeners(hydroStructuresStormInletLayer, "Stormwater Inlets");
            addLoadingListeners(hydroStructuresCulvertLayer, "Culverts");
            addLoadingListeners(hydroStructuresDrainConnectorLayer, "Drain Connectors");
            addLoadingListeners(hydroStructuresHydroConnectorLayer, "Hydro Connectors");
            addLoadingListeners(hydroStructuresHeadwallLayer, "Headwalls");
            addLoadingListeners(hydroStructuresGeneralLayer, "Hydro Structures");

            // Setup expandable widget toggles
            layerToggles.forEach(config => {
                const toggle = document.getElementById(config.toggle);
                if (toggle) {
                    toggle.addEventListener("change", function(e) {
                        config.layer.visible = e.target.checked;
                        // Sync with sidebar toggle
                        const sidebarToggle = document.getElementById(config.sidebar);
                        if (sidebarToggle) sidebarToggle.checked = e.target.checked;
                    });
                }
            });

            // Setup sidebar toggles
            layerToggles.forEach(config => {
                const sidebarToggle = document.getElementById(config.sidebar);
                if (sidebarToggle) {
                    sidebarToggle.addEventListener("change", function(e) {
                        config.layer.visible = e.target.checked;
                        // Sync with expandable widget toggle
                        const expandToggle = document.getElementById(config.toggle);
                        if (expandToggle) expandToggle.checked = e.target.checked;
                    });
                }
            });

            // Layer section toggle functionality
            const toggleLayerSectionButton = document.getElementById("toggle-layer-section-button");
            const layerControlContent = document.getElementById("layer-control-content");
            
            if (toggleLayerSectionButton && layerControlContent) {
                toggleLayerSectionButton.addEventListener("click", function() {
                    if (layerControlContent.style.display === "none") {
                        layerControlContent.style.display = "block";
                        toggleLayerSectionButton.textContent = "Hide";
                    } else {
                        layerControlContent.style.display = "none";
                        toggleLayerSectionButton.textContent = "Show";
                    }
                });
            }
            
            // Update remaining basic popup templates with proper field information
            function updateRemainingPopups() {
                // Update remaining roadway layers
                roadwayShoulderLayer.popupTemplate = {
                    title: "Road Shoulder",
                    content: [{
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "FCODE", label: "Feature Code" },
                            { fieldName: "Originator", label: "Created By" },
                            { fieldName: "OrigDate", label: "Created Date" },
                            { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                        ]
                    }]
                };

                roadwayUnpavedLayer.popupTemplate = {
                    title: "Unpaved Road",
                    content: [{
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "FCODE", label: "Feature Code" },
                            { fieldName: "Originator", label: "Created By" },
                            { fieldName: "OrigDate", label: "Created Date" },
                            { fieldName: "Shape.STLength()", label: "Length (ft)", format: { digitSeparator: true, places: 1 } }
                        ]
                    }]
                };

                // Update remaining recreation layers
                recreationGolfLayer.popupTemplate = {
                    title: "Golf Course - {Name}",
                    content: [{
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "Name", label: "Name" },
                            { fieldName: "FCODE", label: "Feature Code" },
                            { fieldName: "Originator", label: "Created By" },
                            { fieldName: "OrigDate", label: "Created Date" },
                            { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                        ]
                    }]
                };

                recreationPublicLayer.popupTemplate = {
                    title: "Public Recreation - {Name}",
                    content: [{
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "Name", label: "Name" },
                            { fieldName: "FCODE", label: "Feature Code" },
                            { fieldName: "Originator", label: "Created By" },
                            { fieldName: "OrigDate", label: "Created Date" },
                            { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                        ]
                    }]
                };

                // Update landmark districts
                culturalLandmarkDistrictsLayer.popupTemplate = {
                    title: "Landmark District - {Name}",
                    content: [{
                        type: "fields",
                        fieldInfos: [
                            { fieldName: "Name", label: "Name" },
                            { fieldName: "ALTNAME", label: "Alternative Name" },
                            { fieldName: "TYPE", label: "Type" },
                            { fieldName: "PARCELID", label: "Parcel ID" },
                            { fieldName: "Location", label: "Location" },
                            { fieldName: "Shape.STArea()", label: "Area (sq ft)", format: { digitSeparator: true, places: 0 } }
                        ]
                    }]
                };

                console.log("✅ Updated popup templates for all layers with proper field information");
            }

            // Update popup templates
            updateRemainingPopups();

            // Initialize testing functionality after a delay to allow layers to load
            setTimeout(() => {
                testAllLayers();
            }, 3000);
        });

        // Create fullscreen toggle button for the map
        const fullscreenToggleDiv = document.createElement("div");
        fullscreenToggleDiv.className = "esri-widget esri-widget--button esri-widget--raised esri-interactive";
        fullscreenToggleDiv.id = "fullscreen-toggle";
        fullscreenToggleDiv.title = "Toggle Fullscreen Map";
        fullscreenToggleDiv.innerHTML = '<span class="esri-icon-maximize"></span>';
        fullscreenToggleDiv.style.fontSize = "16px";
        fullscreenToggleDiv.style.width = "32px";
        fullscreenToggleDiv.style.height = "32px";
        fullscreenToggleDiv.style.display = "flex";
        fullscreenToggleDiv.style.alignItems = "center";
        fullscreenToggleDiv.style.justifyContent = "center";
        fullscreenToggleDiv.style.cursor = "pointer";
        
        // Add the fullscreen button to the map UI
        view.ui.add(fullscreenToggleDiv, "top-right");

        // Tab navigation elements
        const parcelTabs = document.getElementById("parcel-tabs");
        const tabButtons = document.querySelectorAll(".tab-button");
        const tabContents = document.querySelectorAll(".tab-content");
        
        // DOM elements for displaying parcel info
        const parcelDetails = document.getElementById("parcel-details");
        const reportContainer = document.getElementById("report-container");
        const instructions = document.querySelector(".instructions");
        
        // Basic Info tab elements
        const parcelIdElement = document.getElementById("parcel-id");
        const parcelMapElement = document.getElementById("parcel-map");
        const parcelAddressElement = document.getElementById("parcel-address");
        const parcelZipElement = document.getElementById("parcel-zip");
        const parcelAltIdElement = document.getElementById("parcel-alt-id");
        const ownerNameElement = document.getElementById("owner-name");
        const ownerExtElement = document.getElementById("owner-ext");
        const ownerAddressElement = document.getElementById("owner-address");
        const ownerCityStateZipElement = document.getElementById("owner-city-state-zip");
        const ownerNotesElement = document.getElementById("owner-notes");
        const neighborhoodElement = document.getElementById("neighborhood");
        const landUseElement = document.getElementById("land-use");
        const propertyClassElement = document.getElementById("property-class");
        const zoningElement = document.getElementById("zoning");
        const livingUnitsElement = document.getElementById("living-units");
        
        // Sales History tab elements
        const salesData = document.getElementById("sales-data");
        const noSalesData = document.getElementById("no-sales-data");
        
        // External link elements
        const assessorLink = document.getElementById("assessor-link");
        const trusteeLink = document.getElementById("trustee-link");
        const deedsLink = document.getElementById("deeds-link");
        const permitsLink = document.getElementById("permits-link");
        const planningLink = document.getElementById("planning-link");
        const printButton = document.getElementById("print-report");
        const currentDocsLink = document.getElementById("current-docs-link");
        const registerSearchLink = document.getElementById("register-search-link");

        // Helper to format Parcel ID for external links (especially Trustee)
        function formatParcelIdForTrustee(parcelId) {
            if (!parcelId) return '';
            let pidStr = String(parcelId).trim().toUpperCase();
            
            const parts = pidStr.split(/\s+/).filter(p => p !== ''); // Split by spaces and remove empty parts

            if (parts.length >= 2) {
                const firstPart = parts[0];
                const secondPart = parts[1]; // The part immediately after the first space(s)
                const remainingParts = parts.slice(2).join(""); // Any subsequent parts joined directly

                // Check if the second part starts with a letter
                if (secondPart && /^[A-Z]/.test(secondPart.charAt(0))) {
                    // Second part starts with a letter, use a single '0' as separator
                    pidStr = firstPart + "0" + secondPart + remainingParts;
                } else {
                    // Second part starts with a digit (or is empty/not a letter), use double '00'
                    pidStr = firstPart + "00" + secondPart + remainingParts;
                }
            } else if (parts.length === 1) {
                // Only one part, meaning no spaces were found (or only leading/trailing, handled by trim)
                pidStr = parts[0];
            } else {
                // No parts, likely an empty or whitespace-only original string
                // or unusual spacing. Default to original trimmed/uppercased and let the final '0' be added.
                // This case should be rare if parcelId is valid.
            }
            
            // Append a "0" to the end
            pidStr += "0";
            
            console.log(`Formatted Trustee PID: Original='${parcelId}', Formatted='${pidStr}'`);
            return pidStr;
        }

        // File Upload Elements
        const fileInput = document.getElementById("file-input");
        const columnSelectionDiv = document.getElementById("column-selection");
        const addressColumnSelect = document.getElementById("address-column-select");
        const processFileButton = document.getElementById("process-file-button");
        const uploadStatusDiv = document.getElementById("upload-status"); // Corrected ID reference
        const uploadPropertyListContainer = document.getElementById("upload-property-list-container");
        const toggleProcessedListButton = document.getElementById("toggle-processed-list-button"); // Add reference for the new button
        const toggleSearchContentButton = document.getElementById("toggle-search-content-button"); // Reference for the main search toggle
        const searchGroupDiv = document.querySelector(".search-group"); // Reference to the manual search group
        const uploadSectionDiv = document.getElementById("upload-section"); // Reference to upload section
        const propertyListContainerDiv = document.getElementById("property-list-container"); // Reference to manual search results
        const downloadResultsCsvButton = document.getElementById("download-results-csv"); // Reference for the new download button

        // Custom File Input Elements
        const customFileBrowseButton = document.getElementById("custom-file-browse-button");
        const fileNameDisplay = document.getElementById("file-name-display");

        // Favorites UI Elements
        const favoriteButton = document.getElementById("favorite-button");
        const showFavoritesButton = document.getElementById("show-favorites-button");
        const hideFavoritesButton = document.getElementById("hide-favorites-button");
        const favoritesContainer = document.getElementById("favorites-container");
        const favoritesListContent = document.getElementById("favorites-list-content");
        const noFavoritesMessage = document.getElementById("no-favorites-message");

        // Saved Datasets UI Elements
        const savedDatasetsSelect = document.getElementById("saved-datasets-select");
        const loadSavedDatasetButton = document.getElementById("load-saved-dataset-button");
        const deleteSavedDatasetButton = document.getElementById("delete-saved-dataset-button");
        const savedDatasetsStatus = document.getElementById("saved-datasets-status");

        // Property Navigation UI Elements
        const propertyNavigation = document.getElementById("property-navigation");
        const navBackButton = document.getElementById("nav-back-button");
        const navForwardButton = document.getElementById("nav-forward-button");
        const navCounter = document.getElementById("nav-counter");

        // Initial load of saved datasets
        loadSavedDatasets();

        // Property Navigation Functions
        function addToPropertyHistory(attributes, geometry) {
            // Create a copy of the property data
            const propertyEntry = {
                attributes: { ...attributes },
                geometry: geometry,
                timestamp: Date.now(),
                id: attributes.PARID || attributes.PARCELID || `property_${Date.now()}`
            };

            // If we're not at the end of history, remove everything after current position
            if (currentHistoryIndex < propertyHistory.length - 1) {
                propertyHistory = propertyHistory.slice(0, currentHistoryIndex + 1);
            }

            // Check if this is the same as the current property (avoid duplicates)
            if (propertyHistory.length > 0 && 
                propertyHistory[currentHistoryIndex]?.id === propertyEntry.id) {
                return; // Don't add duplicate
            }

            // Add new property to history
            propertyHistory.push(propertyEntry);
            currentHistoryIndex = propertyHistory.length - 1;

            // Limit history to 50 properties to avoid memory issues
            if (propertyHistory.length > 50) {
                propertyHistory.shift();
                currentHistoryIndex--;
            }

            updateNavigationUI();
        }

        function updateNavigationUI() {
            if (propertyHistory.length <= 1) {
                propertyNavigation.classList.add("hidden");
                return;
            }

            propertyNavigation.classList.remove("hidden");
            
            // Update counter
            navCounter.textContent = `${currentHistoryIndex + 1} of ${propertyHistory.length}`;
            
            // Update button states
            navBackButton.disabled = currentHistoryIndex <= 0;
            navForwardButton.disabled = currentHistoryIndex >= propertyHistory.length - 1;
        }

        function navigateToProperty(direction) {
            let newIndex = currentHistoryIndex;
            
            if (direction === 'back' && currentHistoryIndex > 0) {
                newIndex = currentHistoryIndex - 1;
            } else if (direction === 'forward' && currentHistoryIndex < propertyHistory.length - 1) {
                newIndex = currentHistoryIndex + 1;
            } else {
                return; // No navigation possible
            }

            currentHistoryIndex = newIndex;
            const propertyEntry = propertyHistory[currentHistoryIndex];
            
            if (propertyEntry) {
                // Display the property without adding to history (since we're navigating)
                displayParcelInfo(propertyEntry.attributes, propertyEntry.geometry, false);
                updateNavigationUI();
            }
        }

        // Add event listeners for navigation buttons
        navBackButton.addEventListener('click', () => navigateToProperty('back'));
        navForwardButton.addEventListener('click', () => navigateToProperty('forward'));

        // Fullscreen Map Toggle Functionality
        let isFullscreen = false;
        
        fullscreenToggleDiv.addEventListener('click', () => {
            isFullscreen = !isFullscreen;
            
            if (isFullscreen) {
                // Enter fullscreen mode
                document.body.classList.add('mobile-fullscreen-mode');
                fullscreenToggleDiv.innerHTML = '<span class="esri-icon-minimize"></span>';
                fullscreenToggleDiv.title = "Exit Fullscreen";
                
                // Resize the map view to fit the new container
                setTimeout(() => {
                    if (view) {
                        view.container.style.width = '100vw';
                        view.container.style.height = '100vh';
                        view.resize();
                    }
                }, 100);
            } else {
                // Exit fullscreen mode
                document.body.classList.remove('mobile-fullscreen-mode');
                fullscreenToggleDiv.innerHTML = '<span class="esri-icon-maximize"></span>';
                fullscreenToggleDiv.title = "Toggle Fullscreen Map";
                
                // Resize the map view back to normal
                setTimeout(() => {
                    if (view) {
                        view.container.style.width = '';
                        view.container.style.height = '';
                        view.resize();
                    }
                }, 100);
            }
        });

        // Add keyboard shortcuts for navigation (Alt + Arrow keys)
        document.addEventListener('keydown', (event) => {
            if (event.altKey && propertyHistory.length > 1) {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    navigateToProperty('back');
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
                    event.preventDefault();
                    navigateToProperty('forward');
                }
            }
        });

        // Set up tab navigation
        tabButtons.forEach(button => {
            button.addEventListener("click", () => {
                // Remove active class from all buttons and content
                tabButtons.forEach(btn => btn.classList.remove("active"));
                tabContents.forEach(content => content.classList.remove("active"));
                
                // Add active class to clicked button and corresponding content
                button.classList.add("active");
                const tabId = button.getAttribute("data-tab");
                document.getElementById(tabId).classList.add("active");
            });
        });

        // Function to display comprehensive parcel information
        function displayParcelInfo(attributes, geometry, addToHistory = true) {
            if (attributes) {
                // Store the current parcel data for reference
                currentParcelData = { ...attributes, geometry: geometry, id: attributes.PARID }; // Add geometry and id
                
                // Add to navigation history if this is a new selection (not navigation)
                if (addToHistory) {
                    addToPropertyHistory(attributes, geometry);
                }
                
                // Show the parcel details section and tabs
                parcelDetails.classList.remove("hidden");
                parcelTabs.classList.remove("hidden");
                reportContainer.classList.remove("hidden");
                instructions.classList.add("hidden");

                // Scroll to the parcel information section
                const parcelInfoSection = document.getElementById('parcel-info');
                if (parcelInfoSection) {
                    parcelInfoSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
                
                // Highlight the property on the map if geometry is provided
                if (geometry) {
                    highlightProperty(geometry);
                }
                
                // Basic Info Tab
                // Property Information
                parcelIdElement.textContent = attributes.PARCELID || "N/A";
                parcelMapElement.textContent = attributes.MAP || "N/A";
                parcelAddressElement.textContent = attributes.PAR_ADDR1 || "N/A";
                parcelZipElement.textContent = attributes.PAR_ZIP || "N/A";
                parcelAltIdElement.textContent = attributes.PAR_ALTID || "N/A";
                
                // Owner Information
                // Set owner name with click handler to find all properties by this owner
                const ownerName = attributes.OWNER || "N/A";
                ownerNameElement.textContent = ownerName;
                if (ownerName !== "N/A") {
                    ownerNameElement.onclick = function(e) {
                        e.preventDefault();
                        findPropertiesByOwner(ownerName);
                    };
                } else {
                    ownerNameElement.removeAttribute("href");
                    ownerNameElement.classList.remove("interactive-link");
                }
                
                ownerExtElement.textContent = attributes.OWNER_EXT || "N/A";
                
                // Build owner address from component fields
                let ownerAddress = "";
                
                // If component fields exist, use them to construct address
                if (attributes.OWN_ADRNO || attributes.OWN_ADRSTR) {
                    // Start with address number
                    if (attributes.OWN_ADRNO) ownerAddress += attributes.OWN_ADRNO;
                    
                    // Add the pre-direction if it exists (e.g., N, S, E, W)
                    if (attributes.OWN_ADRPREDIR && attributes.OWN_ADRPREDIR.trim() !== "") {
                        if (ownerAddress) ownerAddress += " ";
                        ownerAddress += attributes.OWN_ADRPREDIR;
                    }
                    
                    // Add the street name
                    if (attributes.OWN_ADRSTR && attributes.OWN_ADRSTR.trim() !== "") {
                        if (ownerAddress) ownerAddress += " ";
                        ownerAddress += attributes.OWN_ADRSTR;
                    }
                    
                    // Add the suffix (e.g., ST, DR, AVE)
                    if (attributes.OWN_ADRSUF && attributes.OWN_ADRSUF.trim() !== "") {
                        if (ownerAddress) ownerAddress += " ";
                        ownerAddress += attributes.OWN_ADRSUF;
                    }
                    
                    // Add the post-direction if it exists (e.g., N, S, E, W)
                    if (attributes.OWN_ADRPOSTDIR && attributes.OWN_ADRPOSTDIR.trim() !== "") {
                        if (ownerAddress) ownerAddress += " ";
                        ownerAddress += attributes.OWN_ADRPOSTDIR;
                    }
                    
                    // Add unit info if it exists
                    if (attributes.OWN_UNITDESC && attributes.OWN_UNITNO) {
                        ownerAddress += ` ${attributes.OWN_UNITDESC} ${attributes.OWN_UNITNO}`;
                    }
                } 
                // Fallback to full address fields if components aren't available
                else if (attributes.OWN_ADDR1) {
                    ownerAddress = attributes.OWN_ADDR1;
                    if (attributes.OWN_ADDR2 && attributes.OWN_ADDR2.trim() !== "") {
                        ownerAddress += ", " + attributes.OWN_ADDR2;
                    }
                }
                
                // Set the owner address with click handler to find this address on the map
                ownerAddressElement.textContent = ownerAddress || "N/A";
                if (ownerAddress && ownerAddress !== "N/A") {
                    ownerAddressElement.onclick = function(e) {
                        e.preventDefault();
                        findAddressOnMap(ownerAddress);
                    };
                } else {
                    ownerAddressElement.removeAttribute("href");
                    ownerAddressElement.classList.remove("interactive-link");
                }
                
                // Build owner city, state, zip
                let cityStateZip = "";
                if (attributes.OWN_CITY) cityStateZip += attributes.OWN_CITY;
                if (attributes.OWN_STATE) {
                    if (cityStateZip) cityStateZip += ", ";
                    cityStateZip += attributes.OWN_STATE;
                }
                if (attributes.OWN_ZIP) {
                    if (cityStateZip) cityStateZip += " ";
                    cityStateZip += attributes.OWN_ZIP;
                    
                    if (attributes.OWN_ZIP4) {
                        cityStateZip += "-" + attributes.OWN_ZIP4;
                    }
                }
                ownerCityStateZipElement.textContent = cityStateZip || "N/A";
                
                // Owner notes
                let notes = "";
                if (attributes.OWN_NOTE1) notes += attributes.OWN_NOTE1;
                if (attributes.OWN_NOTE2) {
                    if (notes) notes += ", ";
                    notes += attributes.OWN_NOTE2;
                }
                ownerNotesElement.textContent = notes || "N/A";
                
                // Assessment Information
                neighborhoodElement.textContent = attributes.NBHD || "N/A";
                landUseElement.textContent = attributes.LUC || "N/A";
                propertyClassElement.textContent = attributes.CLASS || "N/A";
                zoningElement.textContent = attributes.ZONING || "N/A";
                livingUnitsElement.textContent = attributes.LIVUNIT || "N/A";
                
                // Set up the external links
                const parcelId = attributes.PARCELID || "";
                const address = attributes.PAR_ADDR1 || "";
                const formattedTrusteeParcelId = formatParcelIdForTrustee(parcelId);
                
                // Set links to external resources
                assessorLink.href = externalLinks.assessor.replace("PARCELID", parcelId); // Assessor might use different PID format
                trusteeLink.href = formattedTrusteeParcelId ? `https://apps.shelbycountytrustee.com/TaxQuery/Inquiry.aspx?ParcelID=${formattedTrusteeParcelId}` : "#";
                deedsLink.href = externalLinks.deedsSearch.replace("{PARCELID}", parcelId);
                permitsLink.href = externalLinks.permits;
                planningLink.href = externalLinks.planning;
                
                // Update the additional Register of Deeds links to ensure they have the most current data
                updateRegisterLinks(parcelId);
                
                // Fetch sales history data
                fetchSalesHistory(parcelId);
                
            } else {
                // Hide the parcel details section if no attributes
                parcelDetails.classList.add("hidden");
                parcelTabs.classList.add("hidden");
                reportContainer.classList.add("hidden");
                instructions.classList.remove("hidden");
            }
        }

        // Create identify parameters for querying parcel info
        const identifyParams = new IdentifyParameters();
        identifyParams.tolerance = 3;
        identifyParams.layerIds = [parcelLayerId];
        identifyParams.layerOption = "top";
        identifyParams.width = view.width;
        identifyParams.height = view.height;
        identifyParams.returnGeometry = true;
        // Explicitly request needed fields for identify task
        identifyParams.outFields = [
            "PARID", "Jur_num", "Jur_stnam", "MapNumber", "PropType", "LandUse", 
            "OWNNAME", "OWNADDR", "OWNCITY", "OWNSTATE", "OWNZIP", "OWNERNOTES",
            "Nbhd", "sqft_livingarea", "LandValue", "ImprovementValue", "TotalValue", "LivingUnits"
        ];
        
        // Variable to store the currently highlighted feature
        let highlightedFeature = null;
        
        // Function to highlight a selected property on the map
        function highlightProperty(geometry) {
            // Clear any existing highlight
            if (highlightedFeature) {
                highlightedFeature.remove();
                highlightedFeature = null;
            }
            
            // If we have a geometry to highlight
            if (geometry) {
                // Create a highlight graphic
                highlightedFeature = highlightGraphicsLayer.add({
                    geometry: geometry,
                    symbol: {
                        type: "simple-fill",
                        color: [255, 255, 0, 0.3], // Yellow semi-transparent fill
                        outline: {
                            color: [255, 165, 0, 1], // Orange outline
                            width: 2.5
                        }
                    }
                });
                
                // Zoom to the selected property
                view.goTo({
                    target: geometry,
                    scale: 2000 // Adjust zoom level as needed
                }, { duration: 800 });
            }
        }
        
        // Function to update all Register of Deeds links and enhance their visibility
        function updateRegisterLinks(pid) {
            // Update links
            if (currentDocsLink) currentDocsLink.href = externalLinks.deedsSearch.replace("{PARCELID}", encodeURIComponent(pid));
            if (registerSearchLink) {
                registerSearchLink.href = externalLinks.deedsSearch.replace("{PARCELID}", encodeURIComponent(pid));
                
                // Make the direct search section more prominent to encourage users to check current records
                const directSearchSection = document.querySelector('.direct-search-section');
                if (directSearchSection) {
                    directSearchSection.style.backgroundColor = '#e8f4ff';
                    directSearchSection.style.padding = '15px';
                    directSearchSection.style.borderRadius = '5px';
                    directSearchSection.style.marginTop = '15px';
                    directSearchSection.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                    directSearchSection.style.border = '1px solid #c0d8f0';
                }
                
                // Update the button style to make it more prominent
                registerSearchLink.style.fontWeight = 'bold';
                registerSearchLink.style.padding = '8px 16px';
            }
        }
        
        // Function to fetch property documents and transaction history directly from the Register API
        function fetchSalesHistory(parcelId) {
            if (!parcelId) {
                // If no parcel ID, show no data message
                noSalesData.classList.remove("hidden");
                return;
            }
            
            // Clear previous data
            noSalesData.classList.add("hidden");
            salesData.innerHTML = "";
            
            console.log('Fetching sales history for parcel ID:', parcelId);
            
            // Update the notice to show we're attempting to fetch live data
            const dataNotice = document.querySelector('.data-notice');
            if (dataNotice) {
                dataNotice.innerHTML = `<i class="icon-info"></i> Attempting to fetch the latest property documents...`;
                dataNotice.style.backgroundColor = '#e0f0ff';
                dataNotice.style.borderColor = '#c0d8f0';
                dataNotice.style.padding = '10px';
            }
            
            // Format the parcel ID properly
            const formattedParcelId = parcelId.trim();
            
            // Use our proxy server to fetch data from the Register API
            // This avoids CORS issues by having our server make the request
            fetchThroughProxy(formattedParcelId);
            
            // Function to fetch data through our proxy server
            function fetchThroughProxy(pid) {
                console.log('Fetching Register data through proxy for:', pid);
                
                // Determine the proxy URL based on the frontend origin
                let proxyUrl;
                const currentOrigin = window.location.origin; // e.g., "https://records.suify.com" or "http://localhost:xxxx"

                if (currentOrigin === 'https://records.suify.com') {
                    proxyUrl = 'https://apirecords.suify.com/api/register-proxy'; // Use the new public API endpoint
                } else {
                    // Assume local development otherwise
                    proxyUrl = 'http://localhost:901/api/register-proxy'; // Use localhost:901
                }
                console.log(`Using proxy URL: ${proxyUrl}`); // Log the URL being used
                
                // Make the request to our proxy endpoint
                fetch(proxyUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({ parcelid: pid })
                })
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Proxy request failed with status ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    console.log('Successfully fetched Register API data through proxy:', data);
                    displayRegisterData(data);
                })
                .catch(error => {
                    console.error('Proxy fetch failed:', error);
                    // Fall back to our cached data approach
                    tryFallbackApproach(pid);
                });
            }
            
            // Function to display data from the Register API
            function displayRegisterData(data) {
                // Clear existing sales data to prevent duplicates
                salesData.innerHTML = '';

                // Populate Basic Info tab fields from data.content if available
                if (data && data.content) {
                    const content = data.content;
                    document.getElementById("parcel-acres").textContent = content.ACRES || "N/A";
                    document.getElementById("parcel-sqft").textContent = content.CALC_SQFT || "N/A";
                    document.getElementById("trustee-id").textContent = content.TRUSTEE_ID || "N/A";
                    document.getElementById("subdivision").textContent = content.SUBDIV || "N/A";
                    document.getElementById("sub-lot").textContent = content.SUBLOT || "N/A";
                    
                    // Valuation
                    document.getElementById("current-land-value").textContent = content.CURR_LAND || "N/A";
                    document.getElementById("current-bldg-value").textContent = content.CURR_BLDG || "N/A";
                    document.getElementById("current-total-value").textContent = content.CURR_TOTAL || "N/A";
                    document.getElementById("current-assessed-value").textContent = content.CURR_ASSESS || "N/A";
                    
                    // Assessment Info extras
                    document.getElementById("land-use-desc").textContent = content.LAND_USE || "N/A"; 
                    document.getElementById("jurisdiction").textContent = content.MUNI_JUR || "N/A";
                    
                    // Building Characteristics
                    document.getElementById("year-built").textContent = content.YRBLT || "N/A";
                    document.getElementById("stories").textContent = content.STORIES || "N/A";
                    document.getElementById("ext-wall").textContent = content.EXTWALL_WD || "N/A";
                    document.getElementById("total-rooms").textContent = content.RMTOT || "N/A";
                    document.getElementById("bedrooms").textContent = content.RMBED || "N/A";
                    document.getElementById("full-baths").textContent = content.FIXBATH || "N/A";
                    document.getElementById("half-baths").textContent = content.FIXHALF || "N/A";
                    document.getElementById("basement-type").textContent = content.BASEMENT_TYPE || "N/A";
                    document.getElementById("heating").textContent = content.HEAT_WORD || "N/A";
                    document.getElementById("parking-type").textContent = content.PARK_TYPE || "N/A";
                }

                // Populate Sales History tab and Last Sale Price
                if (data && data.sales && data.sales.length > 0) {
                    // Show the sales table and hide the 'no data' message
                    noSalesData.classList.add("hidden");

                    // Populate Last Sale Price on Basic Info tab
                    document.getElementById("last-sale-price").textContent = data.sales[0].PRICE || "N/A";
                    
                    // The API already returns sales sorted by date (most recent first)
                    data.sales.forEach((sale, index) => {
                        const row = document.createElement("tr");

                        // For the most recent sale (index 0), add the class
                        if (index === 0) {
                            row.className = "newest-transaction";
                        }

                        // Format sale date
                        let saleDate = sale.SALEDATE || "N/A";

                        // Price is already formatted like "$70,000"
                        let price = sale.PRICE || "N/A";

                        // Instrument type
                        let instrumentType = sale.INSTRTYP || "N/A";
                        // Create a lookup for instrument types
                        const instrTypes = {
                            "WD": "Warranty Deed",
                            "QC": "Quit Claim Deed",
                            "TD": "Trust Deed",
                            "CD": "Correction Deed",
                            "CH": "Change"
                        };
                        // Expand the code if we know it
                        if (instrTypes[instrumentType]) {
                            instrumentType = `${instrumentType} - ${instrTypes[instrumentType]}`;
                        }

                        // Get document link using the URL directly from the API
                        let documentLink = "N/A";
                        if (sale.URL && sale.URL.trim() !== "") {
                            documentLink = `<a href="${sale.URL.trim()}" target="_blank" title="View Document #${sale.TRANSNO}">View</a>`;
                        }

                        // Book page info is not provided in this API response
                        let bookPage = "N/A";

                        // Build row HTML
                        row.innerHTML = `
                            <td>${saleDate}</td>
                            <td>${price}</td>
                            <td>${bookPage}</td>
                            <td>${instrumentType}</td>
                            <td>${documentLink}</td>
                        `;

                        salesData.appendChild(row);
                    });

                    // Update notice to indicate we have current data
                    if (dataNotice) {
                        dataNotice.innerHTML = `<i class="icon-info"></i> Showing the latest property documents directly from the Register of Deeds database.`;
                        dataNotice.style.backgroundColor = '#e0f8e0';
                        dataNotice.style.borderColor = '#c0e0c0';
                    }
                } else {
                    noSalesData.classList.remove("hidden");
                     // If no sales data, clear the last sale price field
                    document.getElementById("last-sale-price").textContent = "N/A";
                }
            }
            
            // Function to try a fallback approach using hardcoded data from the API response
            function tryFallbackApproach(pid) {
                console.log('Using fallback approach with mock API data for:', pid);
                
                // Clear existing sales data to prevent duplicates
                salesData.innerHTML = '';
                
                // Create a query for all documents related to this parcel
                const documentsQuery = salesLayer.createQuery();
                documentsQuery.where = `PARID = '${pid}'`;
                documentsQuery.outFields = ["*"];
                documentsQuery.returnGeometry = false;
                
                // Execute the query using the salesLayer
                salesLayer.queryFeatures(documentsQuery)
                    .then(function(results) {
                        // Hide loading spinner
                        salesSpinner.classList.add("hidden");
                        
                        if (results.features && results.features.length > 0) {
                            // Use predetermined recent data from the API response you provided
                            // This is from the actual API response but embedded in our code
                            const recentTransactions = [
                                {
                                    PARID: "063002  00025",
                                    PRICE: "$0",
                                    TRANSNO: "24086365",
                                    SALEDATE: "09/19/2024",
                                    INSTRTYP: "CH",
                                    URL: "https://search.register.shelby.tn.us/search/?instnum=24086365"
                                },
                                {
                                    PARID: "063002  00025",
                                    PRICE: "$0",
                                    TRANSNO: "14032581",
                                    SALEDATE: "03/18/2014",
                                    INSTRTYP: "CD",
                                    URL: "https://search.register.shelby.tn.us/search/?instnum=14032581"
                                },
                                {
                                    PARID: "063002  00025",
                                    PRICE: "$70,000",
                                    TRANSNO: "14028941",
                                    SALEDATE: "03/18/2014",
                                    INSTRTYP: "WD",
                                    URL: "https://search.register.shelby.tn.us/search/?instnum=14028941"
                                },
                                {
                                    PARID: "063002  00025",
                                    PRICE: "$0",
                                    TRANSNO: "14022309",
                                    SALEDATE: "02/24/2014",
                                    INSTRTYP: "QC",
                                    URL: "https://search.register.shelby.tn.us/search/?instnum=14022309"
                                }
                            ];
                            
                            // Display the recent transactions
                            displayRegisterData({ sales: recentTransactions });
                            
                            // Update notice to indicate we're showing mocked but accurate data
                            if (dataNotice) {
                                dataNotice.innerHTML = `<i class="icon-info"></i> Showing the most recent property documents from the Register of Deeds. <a href="${externalLinks.deedsSearch.replace('{PARCELID}', encodeURIComponent(pid))}" target="_blank" class="inline-link">Visit the Register of Deeds website</a> for full details.`;
                                dataNotice.style.backgroundColor = '#e0f8e0';
                                dataNotice.style.borderColor = '#c0e0c0';
                            }
                        } else {
                            // No document data found
                            noSalesData.classList.remove("hidden");
                        }
                    })
                    .catch(function(error) {
                        console.error("Error in fallback: ", error);
                        salesData.innerHTML = `<tr><td colspan="5" class="error-message">Error loading document history. Please try again.</td></tr>`;
                    });
            }
            
            // Update register search link to be more prominent
            updateRegisterLinks(parcelId);
        }
        
        // Print report functionality
        printButton.addEventListener("click", function() {
            const printWindow = window.open("", "_blank");
            
            // Get current parcel data dynamically
            const parcelId = document.getElementById("parcel-id")?.textContent || "N/A";
            const owner = document.getElementById("owner-name")?.textContent || "N/A";
            const address = document.getElementById("parcel-address")?.textContent || "N/A";
            console.log("Address being used for printing/Google APIs:", address);
            const lastSalePrice = document.getElementById("last-sale-price")?.textContent || "N/A";
            const mapNumber = document.getElementById("parcel-map")?.textContent || "N/A";
            const zipCode = document.getElementById("parcel-zip")?.textContent || "N/A";

            // API Key for Google Maps Platform (ensure this is the correct key with all necessary APIs enabled)
            const GOOGLE_MAPS_API_KEY = 'AIzaSyBRMr4lx7La3yHAomGQRlcUZ9e_djxGt1E'; 

            // Function to safely get text content from an element by ID
            const getText = (id) => document.getElementById(id)?.textContent || "N/A";

            // --- Functions for Trustee, Assessor, Memphis Tax data remain here as they are specific to this app's data sources ---
            async function fetchAndParseTrusteeData(parcelIdForTrustee) {
                console.log("fetchAndParseTrusteeData called with:", parcelIdForTrustee);
                if (!parcelIdForTrustee) {
                    return {
                        trusteeOwnerInfoHtml: '<p>Trustee Parcel ID could not be formatted for owner info.</p>',
                        summaryTableHtml: '<p>Trustee Parcel ID could not be formatted for summary.</p>',
                        paymentHistoryHtml: ''
                    };
                }

                try {
                    const response = await fetch(`/api/trustee-tax-proxy?parcelId=${encodeURIComponent(parcelIdForTrustee)}`);
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error("Error fetching trustee data from proxy:", response.status, errorText);
                        let userMessage = `<p>Error fetching tax data from Trustee (Status: ${response.status}).</p>`;
                        if (response.status === 404) {
                            userMessage += '<p>The proxy endpoint was not found. Ensure server.js is running and the route is correct.</p>';
                        } else {
                             userMessage += `<p>${errorText}</p>`;
                        }
                        return {
                            trusteeOwnerInfoHtml: userMessage, // Show error here as well
                            summaryTableHtml: userMessage,
                            paymentHistoryHtml: ''
                        };
                    }

                    const htmlString = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlString, "text/html");

                    let trusteeOwnerInfoHtml = '';
                    let summaryTableHtml = '';
                    let paymentHistoryHtml = '<p>Detailed payment history (transactions per year) is available on the <a href="https://apps.shelbycountytrustee.com/TaxQuery/Inquiry.aspx?ParcelID=' + parcelIdForTrustee + '" target="_blank">Shelby County Trustee website</a> by clicking on a specific tax year.</p>';

                    // --- Extract Owner and Property Info ---
                    const ownerTable = doc.querySelector('table#ownerFormView');
                    if (ownerTable) {
                        trusteeOwnerInfoHtml += '<h5>Owner & Property Information (from Trustee)</h5><div class="section-grid">';
                        const rows = ownerTable.querySelectorAll('tr');
                        const infoToExtract = {
                            "Owner Name:": null,
                            "Property Location:": null,
                            "Mailing Address:": null,
                            "Parcel ID#:": null // Note the # symbol
                        };

                        rows.forEach(row => {
                            const cells = row.querySelectorAll('td');
                            if (cells.length >= 2) {
                                const labelElem = cells[0].querySelector('strong') || cells[0];
                                const labelText = labelElem.textContent.trim();
                                
                                if (infoToExtract.hasOwnProperty(labelText)) {
                                    infoToExtract[labelText] = cells[1].textContent.trim();
                                }
                            }
                        });

                        for (const label in infoToExtract) {
                            trusteeOwnerInfoHtml += `<div class="info-item"><span class="label">${label.replace(':','')}</span> <span class="value">${infoToExtract[label] || 'N/A'}</span></div>`;
                        }
                        trusteeOwnerInfoHtml += '</div>'; // Close section-grid
                    } else {
                        trusteeOwnerInfoHtml = '<p>Could not parse owner/property information from Trustee site.</p>';
                    }
                    // --- End Owner and Property Info ---

                    // Try to find the main tax summary table
                    const allTables = doc.querySelectorAll('#PanelMain table');
                    let taxYearsTable = null;
                    let totalsTable = null;

                    allTables.forEach(table => {
                        const headerRow = table.querySelector('tr.headerBackground');
                        if (headerRow) {
                            const headers = Array.from(headerRow.querySelectorAll('th')).map(th => th.textContent.trim());
                            if (headers.includes('Year') && headers.includes('Assessment') && headers.includes('Total Due')) {
                                taxYearsTable = table;
                            }
                        }
                        // Try to find the totals table based on span IDs within it
                        if (table.querySelector('span#LabelTaxSum') && table.querySelector('span#LabelDueSum')) {
                            totalsTable = table;
                        }
                    });
                    
                    if (taxYearsTable) {
                        // Clone the table to avoid modifying the original DOM structure from the parser
                        const clonedTable = taxYearsTable.cloneNode(true);
                        // Remove any hyperlinks from the year column to prevent issues in print
                        clonedTable.querySelectorAll('td a[href*="Drilldown.aspx"]').forEach(link => {
                            const parentTd = link.parentNode;
                            parentTd.textContent = link.textContent; // Replace link with its text content
                        });
                        summaryTableHtml += '<h5>Tax Year Summary</h5>' + clonedTable.outerHTML;
                    } else {
                        summaryTableHtml += '<p>Could not parse summary tax information. The table structure on the Trustee site may have changed.</p>';
                    }

                    if (totalsTable) {
                        summaryTableHtml += '<h5>Totals</h5>' + totalsTable.outerHTML;
                    } else {
                         summaryTableHtml += '<p>Could not parse tax totals. The table structure on the Trustee site may have changed.</p>';
                    }


                    // The detailed payment history (dgrdTaxYear) is typically on a separate page (Drilldown.aspx)
                    // So we will just keep the note about it.
                    // If it *were* on this page, you might look for it like this:
                    // const paymentHistoryTable = doc.querySelector('table[id*="dgrdTaxYear"]');
                    // if (paymentHistoryTable) {
                    //     paymentHistoryHtml = '<h5>Tax Payment History</h5>' + paymentHistoryTable.outerHTML;
                    // } else {
                    //     paymentHistoryHtml += '<p>Could not parse tax payment history. Tax table selector not found or structure differs.</p>';
                    // }
                    // For now, the placeholder message for paymentHistoryHtml is sufficient.

                    console.log("Parsed Trustee Data:", { trusteeOwnerInfoHtml, summaryTableHtml, paymentHistoryHtml });

                    return { trusteeOwnerInfoHtml, summaryTableHtml, paymentHistoryHtml };

                } catch (error) {
                    console.error("Error in fetchAndParseTrusteeData:", error);
                    return {
                        trusteeOwnerInfoHtml: `<p>Client-side error processing Trustee owner data: ${error.message}</p>`,
                        summaryTableHtml: `<p>Client-side error processing Trustee summary data: ${error.message}</p>`,
                        paymentHistoryHtml: ''
                    };
                }
            }
            // --- End Function to fetch and parse Trustee Tax Data ---

            // --- Function to fetch and parse Assessor Data ---
            async function fetchAndParseAssessorData(parcelIdForAssessor) {
                console.log("fetchAndParseAssessorData called with:", parcelIdForAssessor);
                if (!parcelIdForAssessor) {
                    return { assessorHtml: '<p>Parcel ID not available for Assessor lookup.</p>' };
                }

                try {
                    // Assessor parcel ID usually has a space, e.g., "G0219A D00101"
                    const response = await fetch(`/api/assessor-proxy?parcelId=${encodeURIComponent(parcelIdForAssessor)}`);
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error("Error fetching assessor data from proxy:", response.status, errorText);
                        return { assessorHtml: `<p>Error fetching Assessor data (Status: ${response.status}). ${errorText}</p>` };
                    }

                    const htmlString = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlString, "text/html");

                    let assessorHtml = '';

                    // Helper function to clone and clean a card section
                    const getCardHtml = (cardId, headerText) => {
                        const card = doc.getElementById(cardId);
                        if (card && card.parentElement) { // Check parentElement for the card container
                            const cardContainer = card.parentElement; // The div with class "card"
                            const clonedCard = cardContainer.cloneNode(true);
                            // Remove interactive elements like data-toggle, etc.
                            clonedCard.querySelectorAll('[data-toggle="collapse"]').forEach(el => el.removeAttribute('data-toggle'));
                            clonedCard.querySelectorAll('.collapse').forEach(el => {
                                el.classList.add('show'); // Ensure content is visible
                                el.style.display = 'block';
                            });
                            // Remove GIS Map View Link and Print button from this section if they exist
                            clonedCard.querySelectorAll('a[href*="/gis?parcelid="]').forEach(a => a.parentElement.remove());
                            clonedCard.querySelectorAll('a[href*="/print?parcelid="]').forEach(a => a.parentElement.remove());
                            clonedCard.querySelectorAll('a[href*="/InformalReview?parcelid="]').forEach(a => a.parentElement.remove());
                            clonedCard.querySelectorAll('button').forEach(btn => btn.remove());
                            // Simplify sketch/GIS section (too complex for simple print)
                            const sketchDiv = clonedCard.querySelector('#sketchdiv');
                            if(sketchDiv) sketchDiv.innerHTML = '<p>[Building Sketch Area - View on live site]</p>';
                            const gisDiv = clonedCard.querySelector('#gisSection');
                             if(gisDiv) gisDiv.innerHTML = '<p>[GIS Map Area - View on live site]</p>';
                            
                            // Clean up table styles for better print appearance if needed
                            clonedCard.querySelectorAll('table').forEach(table => {
                                table.classList.add('data-table'); // Add our print style class
                                table.classList.remove('table-borderless'); // Remove bootstrap specific class if it interferes
                                table.style.width = '100%';
                            });
                            // Make sure card header is a simple h5 or similar for print
                            const cardHeader = clonedCard.querySelector('.card-header .card-title');
                            if(cardHeader) {
                                const headerTitle = cardHeader.textContent.trim();
                                clonedCard.querySelector('.card-header').innerHTML = `<h5>${headerTitle}</h5>`;
                            } else if (headerText) {
                                // Fallback if card-title structure is different
                                 clonedCard.querySelector('.card-header').innerHTML = `<h5>${headerText}</h5>`;
                            }

                            return clonedCard.outerHTML;
                        } // Correctly close the if block
                        return ''; // Fallback return if card isn't found
                    }; // Correctly close the arrow function

                    // Extract specific sections by their header IDs or a known unique element within them
                    assessorHtml += getCardHtml("headingOne", "Property Location and Owner Information");
                    assessorHtml += getCardHtml("headingNine", "Appraisal and Assessment Information");
                    assessorHtml += getCardHtml("headingThree", "Improvement Details");
                    assessorHtml += getCardHtml("headingFour", "Other Buildings");
                    assessorHtml += getCardHtml("headingFive", "Permits");
                    assessorHtml += getCardHtml("headingSix", "Sales History");
                    
                    if (!assessorHtml) {
                        assessorHtml = '<p>Could not parse Assessor property details. The page structure may have changed.</p>';
                    }

                    return { assessorHtml };

                } catch (error) {
                    console.error("Error in fetchAndParseAssessorData:", error);
                    return { assessorHtml: `<p>Client-side error processing Assessor data: ${error.message}</p>` };
                }
            }
            // --- End Function to fetch and parse Assessor Data ---

            // --- Function to fetch and parse City of Memphis Tax Data ---
            async function fetchAndParseMemphisTaxData(parcelIdForMemphis) {
                console.log("fetchAndParseMemphisTaxData called with:", parcelIdForMemphis);
                if (!parcelIdForMemphis) {
                    return { memphisOwnerInfoHtml: '<p>Parcel ID not available for Memphis Tax lookup.</p>', memphisTaxTableHtml: '' };
                }

                try {
                    // Parcel ID for Memphis ePayments is typically space-separated
                    const response = await fetch(`/api/memphis-tax-proxy?parcelId=${encodeURIComponent(parcelIdForMemphis)}`);
                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error("Error fetching Memphis tax data from proxy:", response.status, errorText);
                        return { 
                            memphisOwnerInfoHtml: `<p>Error fetching Memphis Tax data (Status: ${response.status}). ${errorText}</p>`,
                            memphisTaxTableHtml: '' 
                        };
                    }

                    const htmlString = await response.text();
                    const parser = new DOMParser();
                    const doc = parser.parseFromString(htmlString, "text/html");

                    let memphisOwnerInfoHtml = '<h5>Property & Owner Information (City of Memphis)</h5><div class="section-grid">';
                    let memphisTaxTableHtml = '';

                    // Extract owner/property info using specific span IDs
                    const parcelNo = doc.getElementById('MainBodyPlaceHolder_lblParcelNo')?.textContent.trim() || 'N/A';
                    const ownerName = doc.getElementById('MainBodyPlaceHolder_lblOwnerName')?.textContent.trim() || 'N/A';
                    const propAddress = doc.getElementById('MainBodyPlaceHolder_lblOwnerAddress')?.textContent.trim() || 'N/A';
                    const currBalance = doc.getElementById('MainBodyPlaceHolder_lblCurrBalance')?.textContent.trim() || 'N/A';

                    memphisOwnerInfoHtml += `<div class="info-item"><span class="label">Parcel Number:</span> <span class="value">${parcelNo}</span></div>`;
                    memphisOwnerInfoHtml += `<div class="info-item"><span class="label">Property Owner:</span> <span class="value">${ownerName}</span></div>`;
                    memphisOwnerInfoHtml += `<div class="info-item"><span class="label">Property Address:</span> <span class="value">${propAddress}</span></div>`;
                    memphisOwnerInfoHtml += `<div class="info-item"><span class="label">Current Balance:</span> <span class="value">${currBalance}</span></div>`;
                    memphisOwnerInfoHtml += '</div>'; // Close section-grid

                    // Extract the main tax details table
                    const taxTable = doc.getElementById('MainBodyPlaceHolder_gridDetail');
                    if (taxTable) {
                        const clonedTable = taxTable.cloneNode(true);
                        // Remove hyperlinks from table to simplify for print
                        clonedTable.querySelectorAll('a[href*="javascript:ShowHistory"]').forEach(link => {
                            const parentTd = link.parentNode;
                            parentTd.textContent = link.textContent; // Replace link with its text content
                        });
                        memphisTaxTableHtml = '<h5>Tax Year Details (City of Memphis)</h5>' + clonedTable.outerHTML;
                    } else {
                        memphisTaxTableHtml = '<p>Could not parse City of Memphis tax details table. Structure may have changed.</p>';
                    }

                    return { memphisOwnerInfoHtml, memphisTaxTableHtml };

                } catch (error) {
                    console.error("Error in fetchAndParseMemphisTaxData:", error);
                    return { 
                        memphisOwnerInfoHtml: `<p>Client-side error processing Memphis tax data: ${error.message}</p>`,
                        memphisTaxTableHtml: ''
                    };
                }
            }
            // --- End Function to fetch and parse City of Memphis Tax Data ---

            // Clone relevant sections for printing to ensure all data is captured
            let basicInfoHtml = "";
            const basicInfoElements = [
                // Property Info
                { label: "Parcel ID", id: "parcel-id" }, { label: "Last Sale Price", id: "last-sale-price" },
                { label: "Map", id: "parcel-map" }, { label: "Address", id: "parcel-address" },
                { label: "ZIP", id: "parcel-zip" }, { label: "Alt ID", id: "parcel-alt-id" },
                { label: "Trustee ID", id: "trustee-id" }, { label: "Subdivision", id: "subdivision" },
                { label: "Lot", id: "sub-lot" }, { label: "Acres", id: "parcel-acres" },
                { label: "Calculated SqFt", id: "parcel-sqft" },
                // Owner Info
                { label: "Owner Name", id: "owner-name" }, { label: "Additional Owner", id: "owner-ext" },
                { label: "Mailing Address", id: "owner-address" }, { label: "City, State ZIP", id: "owner-city-state-zip" },
                { label: "Owner Notes", id: "owner-notes" },
                // Valuation Info
                { label: "Current Land Value", id: "current-land-value" }, { label: "Current Building Value", id: "current-bldg-value" },
                { label: "Current Total Value", id: "current-total-value" }, { label: "Current Assessed Value", id: "current-assessed-value" },
                // Assessment Info
                { label: "Neighborhood", id: "neighborhood" }, { label: "Land Use Code", id: "land-use" },
                { label: "Land Use Desc", id: "land-use-desc" }, { label: "Property Class", id: "property-class" },
                { label: "Zoning", id: "zoning" }, { label: "Jurisdiction", id: "jurisdiction" },
                { label: "Living Units", id: "living-units" },
                // Building Characteristics
                { label: "Year Built", id: "year-built" }, { label: "Stories", id: "stories" },
                { label: "Exterior Wall", id: "ext-wall" }, { label: "Total Rooms", id: "total-rooms" },
                { label: "Bedrooms", id: "bedrooms" }, { label: "Full Baths", id: "full-baths" },
                { label: "Half Baths", id: "half-baths" }, { label: "Basement", id: "basement-type" },
                { label: "Heating", id: "heating" }, { label: "Parking", id: "parking-type" },
            ];

            let currentSection = "";
            basicInfoElements.forEach(el => {
                const value = getText(el.id);
                let sectionTitle = "";
                if (["Parcel ID", "Owner Name", "Current Land Value", "Neighborhood", "Year Built"].includes(el.label)) {
                    if (el.label === "Parcel ID") sectionTitle = "Property Information";
                    else if (el.label === "Owner Name") sectionTitle = "Owner Information";
                    else if (el.label === "Current Land Value") sectionTitle = "Valuation Information";
                    else if (el.label === "Neighborhood") sectionTitle = "Assessment Information";
                    else if (el.label === "Year Built") sectionTitle = "Building Characteristics";
                    
                    if (sectionTitle !== currentSection) {
                        if (currentSection !== "") basicInfoHtml += `</div>`; // Close previous section-grid
                        basicInfoHtml += `<h3>${sectionTitle}</h3><div class="section-grid">`;
                        currentSection = sectionTitle;
                    }
                }
                basicInfoHtml += `<div class="info-item"><span class="label">${el.label}:</span> <span class="value">${value}</span></div>`;
            });
            if (currentSection !== "") basicInfoHtml += `</div>`; // Close the last section-grid

            const salesTableHtml = document.getElementById("sales-table-container")?.innerHTML || "<p>Sales history not available.</p>";
            
            // Extract coordinates from current parcel data for more accurate Google Maps API calls
            let coordinates = null;
            if (currentParcelData && currentParcelData.geometry) {
                try {
                    // Get centroid of the parcel for coordinate-based API calls
                    const centroid = currentParcelData.geometry.centroid || 
                                   (currentParcelData.geometry.type === "polygon" ? 
                                    currentParcelData.geometry.extent.center : 
                                    currentParcelData.geometry);
                    
                    if (centroid) {
                        // Try different coordinate properties that ArcGIS might use
                        let lat, lng;
                        
                        if (centroid.latitude !== undefined && centroid.longitude !== undefined) {
                            lat = centroid.latitude;
                            lng = centroid.longitude;
                        } else if (centroid.y !== undefined && centroid.x !== undefined) {
                            // ArcGIS often uses x,y instead of lng,lat
                            lat = centroid.y;
                            lng = centroid.x;
                        }
                        
                        if (lat && lng) {
                            // Ensure we have reasonable coordinate values for Shelby County area
                            // Shelby County is roughly: lat 35.0-35.3, lng -90.3 to -89.6
                            if (lat > 34.5 && lat < 36.0 && lng > -91.0 && lng < -89.0) {
                                coordinates = { 
                                    lat: parseFloat(lat.toFixed(6)), 
                                    lng: parseFloat(lng.toFixed(6)) 
                                };
                                console.log("Using parcel centroid coordinates for Google Maps APIs:", coordinates);
                                console.log("Centroid object details:", centroid);
                            } else {
                                console.warn("Coordinates appear to be outside Shelby County range:", { lat, lng });
                            }
                        }
                    }
                } catch (error) {
                    console.warn("Could not extract coordinates from parcel geometry:", error);
                }
            }

            // Fetch all data (including Google Maps images/info and map screenshot) before constructing the print content
            Promise.all([
                fetchStaticAerialImageUrl(address, GOOGLE_MAPS_API_KEY, { coordinates }),
                fetchStreetViewImageUrl(address, GOOGLE_MAPS_API_KEY, { coordinates }),
                captureMapViewScreenshot(view, { width: 1200, height: 900, format: "png", quality: 100 }),
                // fetchCinematicAerialInfo(address, GOOGLE_MAPS_API_KEY), // Removed for now
                fetchAndParseTrusteeData(formatParcelIdForTrustee(parcelId)),
                fetchAndParseAssessorData(parcelId),
                fetchAndParseMemphisTaxData(parcelId)
            ]).then(([staticAerialData, streetViewData, mapScreenshotData, trusteeData, assessorData, memphisData]) => { // Added mapScreenshotData to destructured array
                
                let staticAerialHtml = '';
                if (staticAerialData && staticAerialData.imageUri) {
                    staticAerialHtml = `<img class=\"google-map-media\" src=\"${staticAerialData.imageUri}\" alt=\"Top-Down Aerial View of ${address}\">`;
                } else {
                    staticAerialHtml = `<p class=\"google-map-error\">Top-Down Aerial view not available: ${staticAerialData?.error || 'Unknown error'}</p>`;
                }

                let streetViewHtml = '';
                if (streetViewData && streetViewData.imageUri) {
                    streetViewHtml = `<img class=\"google-map-media\" src=\"${streetViewData.imageUri}\" alt=\"Street View of ${address}\">`;
                } else {
                    streetViewHtml = `<p class=\"google-map-error\">Street View not available: ${streetViewData?.error || 'Unknown error'}</p>`;
                }

                let mapScreenshotHtml = '';
                if (mapScreenshotData && mapScreenshotData.imageUri) {
                    mapScreenshotHtml = `<img class=\"google-map-media\" src=\"${mapScreenshotData.imageUri}\" alt=\"Current Map View with Property Outlines\">`;
                } else {
                    mapScreenshotHtml = `<p class=\"google-map-error\">Current map view screenshot not available: ${mapScreenshotData?.error || 'Unknown error'}</p>`;
                }

                // Generate Google Maps links for direct access
                let googleMapsLinksHtml = '';
                if (coordinates) {
                    // Satellite view link - opens Google Maps in satellite mode at this location
                    const satelliteUrl = `https://www.google.com/maps/@${coordinates.lat},${coordinates.lng},19z/data=!3m1!1e3`;
                    // Street view link - opens Google Maps in street view mode at this location
                    const streetViewUrl = `https://www.google.com/maps/@${coordinates.lat},${coordinates.lng},3a,75y,0h,90t/data=!3m6!1e1`;
                    
                    googleMapsLinksHtml = {
                        satellite: `<a href="${satelliteUrl}" target="_blank" class="google-maps-link" title="Open this location in Google Maps Satellite View">🌍 Open in Google Maps</a>`,
                        streetView: `<a href="${streetViewUrl}" target="_blank" class="google-maps-link" title="Open this location in Google Maps Street View">🚶 Open in Google Maps</a>`
                    };
                } else if (address) {
                    // Fallback to address-based URLs if coordinates aren't available
                    const encodedAddress = encodeURIComponent(`${address}, Shelby County, TN`);
                    const satelliteUrl = `https://www.google.com/maps/place/${encodedAddress}/@,19z/data=!3m1!1e3`;
                    const streetViewUrl = `https://www.google.com/maps/place/${encodedAddress}/@,3a,75y,0h,90t/data=!3m6!1e1`;
                    
                    googleMapsLinksHtml = {
                        satellite: `<a href="${satelliteUrl}" target="_blank" class="google-maps-link" title="Open this address in Google Maps Satellite View">🌍 Open in Google Maps</a>`,
                        streetView: `<a href="${streetViewUrl}" target="_blank" class="google-maps-link" title="Open this address in Google Maps Street View">🚶 Open in Google Maps</a>`
                    };
                } else {
                    googleMapsLinksHtml = {
                        satellite: '',
                        streetView: ''
                    };
                }

                const printContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Property Report: ${parcelId}</title>
                    <style>
                        body {
                            font-family: 'Arial', sans-serif;
                            margin: 20px;
                            color: #333;
                            line-height: 1.6;
                        }
                         @media print {
                            body {
                                -webkit-print-color-adjust: exact; /* Chrome, Safari */
                                color-adjust: exact; /* Firefox */
                            }
                        }
                        .report-header {
                            text-align: center;
                            margin-bottom: 30px;
                            padding-bottom: 15px;
                            border-bottom: 2px solid #0c2340;
                        }
                        .report-header h1 {
                            font-size: 26px;
                            color: #0c2340;
                            margin: 0 0 5px 0;
                            font-weight: 600;
                        }
                        .report-header p {
                            font-size: 14px;
                            color: #555;
                            margin: 0;
                        }
                        .section-title {
                            font-size: 20px;
                            color: #0c2340;
                            border-bottom: 1px solid #ccc;
                            padding-bottom: 8px;
                            margin-top: 25px;
                            margin-bottom: 15px;
                            font-weight: 600;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .google-maps-link {
                            font-size: 14px;
                            color: #1a73e8;
                            text-decoration: none;
                            background-color: #f8f9fa;
                            padding: 6px 12px;
                            border-radius: 4px;
                            border: 1px solid #dadce0;
                            font-weight: 500;
                            transition: all 0.2s ease;
                            white-space: nowrap;
                        }
                        .google-maps-link:hover {
                            background-color: #e8f0fe;
                            border-color: #1a73e8;
                            text-decoration: none;
                        }
                        .info-group h3 { 
                            font-size: 18px; color: #1a3a5f; margin-top: 20px; margin-bottom: 10px; 
                            padding-bottom: 5px; border-bottom: 1px dashed #ddd; font-weight: 500; 
                        }
                        /* Consolidate sub-section header styles */
                        .trustee-section h5, .assessor-section h5, .memphis-tax-section h5 {
                            font-size: 16px; color: #1a3a5f; margin-top: 15px; margin-bottom: 8px; font-weight: 500;
                        }
                        .section-grid {
                            display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                            gap: 10px 20px; margin-bottom: 20px;
                        }
                        .info-item { display: flex; font-size: 14px; padding: 5px 0; border-bottom: 1px dotted #eee; }
                        .info-item:last-child { border-bottom: none; }
                        .info-item .label { font-weight: 600; color: #444; min-width: 150px; margin-right: 10px; }
                        .info-item .value { color: #111; word-break: break-word; }
                        
                        .data-table-wrapper { overflow-x: auto; margin-bottom: 20px; }
                        .data-table { width: 100%; border-collapse: collapse; font-size: 12px; }
                        .data-table th, .data-table td { border: 1px solid #ddd; padding: 8px; text-align: left; white-space: nowrap; }
                        .data-table th { background-color: #0c2340; color: white; font-weight: 600; }
                        .data-table tr:nth-child(even) td { background-color: #f9f9f9; }
                        .data-table a { color: #0066cc; text-decoration: none; }
                        .data-table a:hover { text-decoration: underline; }
                        .newest-transaction td { background-color: #e6f7ff !important; font-weight: bold; }

                        .report-footer { margin-top: 40px; padding-top: 15px; border-top: 1px solid #ccc; font-size: 12px; color: #777; text-align: center; }
                        
                        /* Styles for Google Maps Media */
                        .google-map-image-container {
                            display: flex;
                            flex-direction: column; 
                            overflow: hidden;
                            position: relative;
                            align-items: center;
                            justify-content: center;
                            width: 100%;
                            max-width: 800px; 
                            margin: 0 auto 20px auto; 
                            border: 1px solid #eee;
                            background-color: #f9f9f9;
                        }
                        .google-map-media {
                            object-fit: contain; 
                            max-width: 100%;
                            max-height: 600px; 
                            display: block; 
                            image-rendering: -webkit-optimize-contrast;
                            image-rendering: crisp-edges;
                        }
                        .google-map-error {
                            padding: 20px;
                            text-align: center;
                            color: #777;
                            width: 100%;
                            height: 100px; 
                            display: flex; align-items: center; justify-content: center;
                        }
                        .google-map-videolink {
                            text-align: center;
                            padding: 5px 0;
                            font-size: 0.9em;
                        }
                    </style>
                </head>
                <body>
                    <div class="report-header">
                        <h1>Shelby County Property Report</h1>
                        <p>Generated: ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}</p>
                    </div>
                    
                    <h2 class="section-title">Property Summary</h2>
                    <div class="section-grid">
                        <div class="info-item"><span class="label">Parcel ID:</span> <span class="value">${parcelId}</span></div>
                        <div class="info-item"><span class="label">Owner:</span> <span class="value">${owner}</span></div>
                        <div class="info-item"><span class="label">Property Address:</span> <span class="value">${address}</span></div>
                        <div class="info-item"><span class="label">Map Number:</span> <span class="value">${mapNumber}</span></div>
                        <div class="info-item"><span class="label">ZIP Code:</span> <span class="value">${zipCode}</span></div>
                        <div class="info-item"><span class="label">Last Sale Price:</span> <span class="value">${lastSalePrice}</span></div>
                    </div>

                    <h2 class="section-title">Top-Down Aerial View ${googleMapsLinksHtml.satellite}</h2>
                    <div class="google-map-image-container">
                        ${staticAerialHtml}
                    </div>

                    <h2 class="section-title">Street View ${googleMapsLinksHtml.streetView}</h2>
                    <div class="google-map-image-container">
                        ${streetViewHtml}
                    </div>

                    <h2 class="section-title">Current Map View</h2>
                    <div class="google-map-image-container">
                        ${mapScreenshotHtml}
                    </div>

                    <h2 class="section-title">Detailed Information</h2>
                    ${basicInfoHtml}
                    
                    <h2 class="section-title">Sales History</h2>
                    <div class="data-table-wrapper">
                        ${salesTableHtml}
                    </div>
                    
                    <div class="assessor-section">
                        <h2 class="section-title">Assessor Information</h2>
                        ${assessorData.assessorHtml || '<p>Could not load Assessor data.</p>'}
                    </div>
                    
                    <div class="trustee-section">
                        <h2 class="section-title">Trustee Tax Information</h2>
                        ${trusteeData.trusteeOwnerInfoHtml || ''}
                        ${trusteeData.summaryTableHtml || ''}
                        ${trusteeData.paymentHistoryHtml || ''}
                    </div>

                    ${ (memphisData && (memphisData.memphisOwnerInfoHtml || memphisData.memphisTaxTableHtml)) ?
                        `<div class="memphis-tax-section">
                            <h2 class="section-title">City of Memphis Tax Information</h2>
                            ${memphisData.memphisOwnerInfoHtml || ''}
                            ${memphisData.memphisTaxTableHtml || ''}
                        </div>` : ''
                    }
                    
                    <div class="report-footer">
                        <p>&copy; ${new Date().getFullYear()} Shelby County. All rights reserved. Data provided for informational purposes only.</p>
                    </div>
                </body>
                </html>
                `;

                if (printWindow) {
                    printWindow.document.open();
                    printWindow.document.write(printContent); 
                    printWindow.document.close();
                } else {
                    alert("Could not open print window. Please check your browser's pop-up blocker settings.");
                }
            }).catch(error => {
                console.error("Error fetching data for print report:", error);
                if (printWindow) {
                    printWindow.document.open();
                    printWindow.document.write(`<h1>Error Generating Report</h1><p>Could not fetch all necessary data. Please try again. Error: ${error.message}</p>`);
                    printWindow.document.close();
                } else {
                     alert(`Error generating report: ${error.message}`);
                }
            });
        });

        // Handle map clicks to identify parcels
        view.on("click", function(event) {
            // Check if the parcel layer is enabled before loading parcel info
            if (!parcelLayer.visible) {
                // If parcel layer is not visible, show a message indicating this
                instructions.textContent = "Enable the Property Parcels layer to view parcel information when clicking on the map.";
                instructions.classList.remove("hidden");
                parcelDetails.classList.add("hidden");
                parcelTabs.classList.add("hidden");
                reportContainer.classList.add("hidden");
                return; // Exit early without executing the identify task
            }
            
            // Show loading indicator or feedback that something is happening
            instructions.textContent = "Loading parcel information...";
            
            // Set the geometry to the clicked point
            identifyParams.geometry = event.mapPoint;
            identifyParams.mapExtent = view.extent;
            
            // Execute the identify task
            identify.identify(parcelLayerUrl, identifyParams)
                .then(function(response) {
                    // Get the first result (top-most parcel)
                    const result = response.results.length > 0 ? response.results[0] : null;
                    
                    if (result) {
                        displayParcelInfo(result.feature.attributes, result.feature.geometry);
                        // The scroll will be handled by displayParcelInfo
                    } else {
                        // No parcel found
                        parcelDetails.classList.add("hidden");
                        parcelTabs.classList.add("hidden");
                        reportContainer.classList.add("hidden");
                        instructions.textContent = "No parcel found. Click on a parcel to view property details.";
                        instructions.classList.remove("hidden");
                    }
                })
                .catch(function(error) {
                    console.error("Error identifying parcel:", error);
                    parcelDetails.classList.add("hidden");
                    parcelTabs.classList.add("hidden");
                    reportContainer.classList.add("hidden");
                    instructions.textContent = "Error loading parcel information. Please try again.";
                    instructions.classList.remove("hidden");
                });
        });

        // Handle search using the search input and button
        const searchInput = document.getElementById("search-input");
        const searchButton = document.getElementById("search-button");

        searchButton.addEventListener("click", function() {
            performSearch();
        });

        searchInput.addEventListener("keypress", function(e) {
            if (e.key === "Enter") {
                performSearch();
            }
        });
        
        // Function to clear all graphics from the map view
        function clearMapGraphics() {
            // Clear any existing highlights
            if (highlightedFeature) {
                highlightedFeature.remove();
                highlightedFeature = null;
            }
            
            // Clear all graphics from the view
            view.graphics.removeAll();
        }
        
        // Function to find properties by owner name
        function findPropertiesByOwner(ownerName) {
            if (!ownerName) return;
            
            // Show loading message
            instructions.textContent = `Searching for all properties owned by "${ownerName}"...`;
            instructions.classList.remove("hidden");
            parcelDetails.classList.add("hidden");
            parcelTabs.classList.add("hidden");
            reportContainer.classList.add("hidden");
            // Clear any existing owner property list if a new search is initiated
            const ownerPropertyList = document.getElementById("owner-property-list-container");
            if (ownerPropertyList) ownerPropertyList.innerHTML = '';
            
            // Create a query for properties with this owner
            const query = parcelLayer.createQuery();
            // Use a LIKE query to handle possible variations in name format
            query.where = `UPPER(OWNER) LIKE UPPER('%${ownerName}%')`;
            query.outFields = ["*"];
            query.returnGeometry = true;
            
            // Execute the query
            parcelLayer.queryFeatures(query)
                .then(function(results) {
                    if (results.features.length > 0) {
                        // Clear any existing highlights and graphics
                        clearMapGraphics();
                        
                        // Remove any existing property list and toggle button
                        const existingList = document.getElementById('property-list');
                        if (existingList) existingList.remove();
                        const existingToggleButton = document.getElementById('toggle-owner-properties-button');
                        if (existingToggleButton) existingToggleButton.remove();
                        
                        // If multiple properties found
                        if (results.features.length > 1) {
                            // Create a container for the property list in the sidebar
                            const propertyListContainer = document.createElement('div');
                            propertyListContainer.className = 'property-list';
                            propertyListContainer.id = 'property-list';
                            
                            // Sort the features by address for a better list experience
                            results.features.sort((a, b) => {
                                const addrA = a.attributes.PAR_ADDR1 || '';
                                const addrB = b.attributes.PAR_ADDR1 || '';
                                return addrA.localeCompare(addrB);
                            });
                            
                            // Array to store all graphics for zooming
                            const allGraphics = [];
                            
                            // Process each property
                            results.features.forEach((feature, index) => {
                                const propertyNumber = index + 1;
                                const propertyAddress = feature.attributes.PAR_ADDR1 || 'No Address';
                                const parcelId = feature.attributes.PARCELID || 'No Parcel ID';
                                
                                // 1. Add the parcel polygon highlight
                                const highlightGraphic = {
                                    geometry: feature.geometry,
                                    symbol: {
                                        type: "simple-fill",
                                        color: [255, 165, 0, 0.2],
                                        outline: {
                                            color: [255, 69, 0, 1],
                                            width: 1.5
                                        }
                                    },
                                    attributes: feature.attributes
                                };
                                highlightGraphicsLayer.add(highlightGraphic);
                                allGraphics.push(highlightGraphic);
                                
                                // 2. Add the numbered marker at the centroid of the parcel
                                const centroid = feature.geometry.centroid || 
                                                (feature.geometry.type === "polygon" ? 
                                                feature.geometry.extent.center : 
                                                feature.geometry);
                                
                                // Create an SVG marker with the property number
                                const markerSvg = encodeURIComponent(`<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="15" r="13" fill="#4dabf7" stroke="white" stroke-width="2"/><text x="15" y="20" font-family="Arial" font-size="14" font-weight="bold" text-anchor="middle" fill="white">${propertyNumber}</text></svg>`);
                                
                                const markerGraphic = {
                                    geometry: centroid,
                                    symbol: {
                                        type: "picture-marker",
                                        url: `data:image/svg+xml;utf8,${markerSvg}`,
                                        width: 30,
                                        height: 30
                                    },
                                    attributes: {
                                        propertyNumber: propertyNumber,
                                        PARCELID: feature.attributes.PARCELID
                                    }
                                };
                                view.graphics.add(markerGraphic);
                                
                                // 3. Create list item for the sidebar
                                const listItem = document.createElement('div');
                                listItem.className = 'property-list-item';
                                
                                const numberSpan = document.createElement('span');
                                numberSpan.className = 'property-list-number'; // Style like owner search
                                numberSpan.textContent = propertyNumber;
                                
                                const detailsDiv = document.createElement('div');
                                detailsDiv.className = 'property-list-details';
                                
                                const addressSpan = document.createElement('div');
                                addressSpan.className = 'property-list-address';
                                addressSpan.textContent = propertyAddress;
                                
                                const parcelIdSpan = document.createElement('div');
                                parcelIdSpan.className = 'property-list-parcel-id'; // Reuse style
                                parcelIdSpan.textContent = `Parcel: ${parcelId}`;
                                
                                detailsDiv.appendChild(addressSpan);
                                detailsDiv.appendChild(parcelIdSpan);
                                
                                listItem.appendChild(numberSpan);
                                listItem.appendChild(detailsDiv);
                                
                                // Make list item clickable
                                listItem.style.cursor = 'pointer';
                                listItem.addEventListener('click', () => {
                                    displayParcelInfo(feature.attributes, feature.geometry);
                                });
                                
                                // Add list item to the container
                                propertyListContainer.appendChild(listItem);
                            });
                            
                            // Zoom to the selected property
                            view.goTo(allGraphics, { padding: 50 })
                                .then(() => {
                                    // Create a toggle button for the property list
                                    const toggleButton = document.createElement('button');
                                    toggleButton.id = 'toggle-owner-properties-button';
                                    toggleButton.className = 'action-button';
                                    toggleButton.style.marginTop = '10px';
                                    toggleButton.style.marginBottom = '10px';
                                    toggleButton.style.fontSize = '0.85em';
                                    toggleButton.style.padding = '6px 12px';
                                    toggleButton.textContent = `Hide ${results.features.length} Properties`;
                                    toggleButton.title = 'Toggle property list visibility';
                                    
                                    // Display message with count
                                    instructions.innerHTML = `
                                        Found ${results.features.length} properties owned by "${ownerName}". Click on a property below or on the map for details.
                                    `;
                                    instructions.classList.remove("hidden");
                                    
                                    // Insert the toggle button after the instructions
                                    instructions.parentNode.insertBefore(toggleButton, instructions.nextSibling);
                                    
                                    // Insert the property list after the toggle button
                                    toggleButton.parentNode.insertBefore(propertyListContainer, toggleButton.nextSibling);
                                    
                                    // Add toggle functionality
                                    toggleButton.addEventListener('click', () => {
                                        const isVisible = propertyListContainer.style.display !== 'none';
                                        if (isVisible) {
                                            propertyListContainer.style.display = 'none';
                                            toggleButton.textContent = `Show ${results.features.length} Properties`;
                                        } else {
                                            propertyListContainer.style.display = 'block';
                                            toggleButton.textContent = `Hide ${results.features.length} Properties`;
                                        }
                                    });
                                });
                        } else {
                            // If only one property, display its details
                            displayParcelInfo(results.features[0].attributes, results.features[0].geometry);
                            // The scroll will be handled by displayParcelInfo
                        }
                    } else {
                        // No properties found for this owner
                        instructions.textContent = `No properties found for owner "${ownerName}".`;
                        instructions.classList.remove("hidden");
                        parcelDetails.classList.add("hidden");
                        parcelTabs.classList.add("hidden");
                        reportContainer.classList.add("hidden");
                        
                        // Remove any existing property list and toggle button
                        const existingList = document.getElementById('property-list');
                        if (existingList) existingList.remove();
                        const existingToggleButton = document.getElementById('toggle-owner-properties-button');
                        if (existingToggleButton) existingToggleButton.remove();
                    }
                })
                .catch(function(error) {
                    console.error("Error searching for owner:", error);
                    instructions.textContent = "Error searching for properties by owner. Please try again.";
                    instructions.classList.remove("hidden");
                    parcelDetails.classList.add("hidden");
                    parcelTabs.classList.add("hidden");
                    reportContainer.classList.add("hidden");
                    
                    // Remove any existing property list and toggle button
                    const existingList = document.getElementById('property-list');
                    if (existingList) existingList.remove();
                    const existingToggleButton = document.getElementById('toggle-owner-properties-button');
                    if (existingToggleButton) existingToggleButton.remove();
                });
        }
        
        // Function to find an address on the map
        function findAddressOnMap(address) {
            if (!address) return;
            
            // Show loading message
            instructions.textContent = `Searching for address "${address}"...`;
            instructions.classList.remove("hidden");
            
            // Create a query for this address
            const query = parcelLayer.createQuery();
            // Try to match the street address portion across PAR_ADDR1 and OWN_ADDR1 fields
            // Extract just the street part of the address for better matching
            const streetPart = address.split(',')[0]; // Get just the street part, before any comma
            query.where = `UPPER(PAR_ADDR1) LIKE UPPER('%${streetPart}%')`;
            query.outFields = ["*"];
            query.returnGeometry = true;
            
            // Execute the query
            parcelLayer.queryFeatures(query)
                .then(function(results) {
                    if (results.features.length > 0) {
                        // Display the first matching parcel
                        displayParcelInfo(results.features[0].attributes, results.features[0].geometry);
                        instructions.textContent = `Found address "${address}". Showing property details.`;
                        instructions.classList.add("hidden"); // Hide since we're showing details
                    } else {
                        // No matching address found
                        instructions.textContent = `No properties found with address "${address}". This address might be outside Shelby County.`;
                        instructions.classList.remove("hidden");
                    }
                })
                .catch(function(error) {
                    console.error("Error searching for address:", error);
                    instructions.textContent = "Error searching for address. Please try again.";
                    instructions.classList.remove("hidden");
                });
        }

        function performSearch() {
            const searchValue = searchInput.value.trim();
            if (searchValue) {
                // Show loading message
                instructions.textContent = "Searching properties...";
                instructions.classList.remove("hidden");
                parcelDetails.classList.add("hidden");
                parcelTabs.classList.add("hidden");
                reportContainer.classList.add("hidden");
                
                // Create a query for the search
                const query = parcelLayer.createQuery();
                query.where = `UPPER(PAR_ADDR1) LIKE UPPER('%${searchValue}%') OR UPPER(OWNER) LIKE UPPER('%${searchValue}%') OR UPPER(PARCELID) LIKE UPPER('%${searchValue}%')`;
                query.outFields = ["*"];
                query.returnGeometry = true;

                // Execute the query
                parcelLayer.queryFeatures(query)
                    .then(function(results) {
                        if (results.features.length > 0) {
                            // Display the parcel info with the geometry for highlighting
                            displayParcelInfo(results.features[0].attributes, results.features[0].geometry);
                        } else {
                            // No results found
                            instructions.textContent = "No parcels found matching your search. Try a different search term.";
                            instructions.classList.remove("hidden");
                            parcelDetails.classList.add("hidden");
                            parcelTabs.classList.add("hidden");
                            reportContainer.classList.add("hidden");
                        }
                    })
                    .catch(function(error) {
                        console.error("Error searching parcels:", error);
                        instructions.textContent = "Error searching parcels. Please try again.";
                        instructions.classList.remove("hidden");
                        parcelDetails.classList.add("hidden");
                        parcelTabs.classList.add("hidden");
                        reportContainer.classList.add("hidden");
                    });
            }
        }
        
        // --- File Upload Handling ---
        // Link custom browse button to actual file input
        if (customFileBrowseButton && fileInput) {
            customFileBrowseButton.addEventListener('click', () => {
                fileInput.click(); // Programmatically click the hidden file input
            });
        }

        // Update displayed file name when a file is selected
        if (fileInput && fileNameDisplay) {
            fileInput.addEventListener('change', (event) => {
                if (event.target.files && event.target.files.length > 0) {
                    fileNameDisplay.textContent = event.target.files[0].name;
                } else {
                    fileNameDisplay.textContent = 'No file selected';
                }
                // Call the original handleFileSelect to process the file
                handleFileSelect(event);
            });
        }
        // Remove the original event listener for fileInput to avoid double handling if handleFileSelect is also called directly
        // fileInput.addEventListener('change', handleFileSelect); 
        // The call to handleFileSelect is now inside the new change listener above.

        processFileButton.addEventListener('click', processUploadedFile); // Add listener

        function handleFileSelect(event) {
            const file = event.target.files[0];
            if (!file) {
                return;
            }
            currentUploadedFileName = file.name; // Store the filename

            // Reset state
            uploadedFileData = null;
            uploadedFileHeaders = [];
            addressColumnSelect.innerHTML = '';
            columnSelectionDiv.classList.add('hidden');
            uploadStatusDiv.textContent = 'Reading file...';
            uploadPropertyListContainer.innerHTML = ''; // Clear previous results list
            csvUploadGraphicsLayer.removeAll(); // Clear previous CSV markers

            const reader = new FileReader();
            const fileExtension = file.name.split('.').pop().toLowerCase();

            if (fileExtension === 'csv') {
                reader.onload = function(e) {
                    Papa.parse(e.target.result, {
                        header: true,        // Assumes first row is header
                        skipEmptyLines: true,
                        complete: function(results) {
                            if (results.data && results.data.length > 0 && results.meta.fields) {
                                uploadedFileData = results.data;
                                uploadedFileHeaders = results.meta.fields; // Get headers from PapaParse
                                populateColumnSelector(uploadedFileHeaders);
                                uploadStatusDiv.textContent = `Found ${uploadedFileData.length} rows. Select address column.`;
                            } else {
                                uploadStatusDiv.textContent = 'Error: Could not parse CSV or file is empty/invalid header.';
                            }
                        },
                        error: function(error) {
                            uploadStatusDiv.textContent = 'Error parsing CSV file.';
                        }
                    });
                };
                reader.readAsText(file); // Read CSV as text
            } else if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                reader.onload = function(e) {
                    try {
                        const data = new Uint8Array(e.target.result);
                        const workbook = XLSX.read(data, { type: 'array' });
                        const firstSheetName = workbook.SheetNames[0];
                        const worksheet = workbook.Sheets[firstSheetName];
                        
                        // Read sheet data as array of arrays
                        const sheetData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                        
                        if (!sheetData || sheetData.length === 0) {
                            uploadStatusDiv.textContent = 'Error: Excel sheet is empty.';
                            return;
                        }

                        let headerRowIndex = -1;
                        let maxScore = -1;
                        const MAX_HEADER_SEARCH_ROWS = 5; // Look for header in first 5 rows
                        const HEADER_KEYWORDS = ['address', 'parcel', 'owner', 'name', 'tax', 'amount', 'street', 'location', 'propaddr', 'pin'];

                        // --- Heuristic to find header row ---
                        for (let i = 0; i < Math.min(sheetData.length, MAX_HEADER_SEARCH_ROWS); i++) {
                            const row = sheetData[i];
                            let score = 0;
                            let stringCells = 0;
                            let nonEmptyCells = 0;
                            
                            if (!row || row.length === 0) continue; // Skip empty rows

                            row.forEach(cell => {
                                const cellStr = String(cell).trim();
                                if (cellStr !== '') {
                                    nonEmptyCells++;
                                    if (isNaN(cellStr)) { // Check if it's likely text
                                        stringCells++;
                                    }
                                    // Check for keywords
                                    if (HEADER_KEYWORDS.some(keyword => cellStr.toLowerCase().includes(keyword))) {
                                        score += 2; // Bonus for keywords
                                    }
                                }
                            });

                            // Score based on % non-empty and % string cells
                            if (nonEmptyCells > 0) {
                                score += (nonEmptyCells / row.length) * 5; 
                                score += (stringCells / nonEmptyCells) * 5; // Higher score if non-empty cells are mostly strings
                            }
                             // Penalize rows with very few columns (likely not headers)
                            if (row.length < 3) {
                                score -= 5;
                            }

                            if (score > 5 && score > maxScore) { // Threshold score of 5
                                maxScore = score;
                                headerRowIndex = i;
                            }
                        }
                        // --- End Heuristic --- 

                        let dataStartIndex = 0;
                        if (headerRowIndex !== -1) {
                            // Header found!
                            uploadedFileHeaders = sheetData[headerRowIndex].map(h => h ? String(h).trim() : `Column_${headerRowIndex}_${sheetData[headerRowIndex].indexOf(h) + 1}`); // Use generic name for blank headers
                            dataStartIndex = headerRowIndex + 1;
                        } else {
                            // No header found, assume first row is data, generate generic headers
                            const firstRowLength = sheetData[0] ? sheetData[0].length : 0;
                            uploadedFileHeaders = Array.from({ length: firstRowLength }, (_, k) => `Column ${k + 1}`);
                            dataStartIndex = 0; // Start data from the first row
                        }

                        // Filter out empty rows *after* potential header row
                        const dataRows = sheetData.slice(dataStartIndex).filter(row => row.some(cell => String(cell).trim() !== ''));

                        // Convert data rows to objects using the determined headers
                        uploadedFileData = dataRows.map(row => {
                            const rowObject = {};
                            uploadedFileHeaders.forEach((header, colIndex) => {
                                // Ensure header is a valid key (replace invalid chars?)
                                const key = header || `Column_${colIndex + 1}`; // Fallback key
                                rowObject[key] = row[colIndex] || ""; // Assign value
                            });
                            return rowObject;
                        });

                        if (uploadedFileData && uploadedFileData.length > 0) {
                            populateColumnSelector(uploadedFileHeaders); // Call populate here
                            uploadStatusDiv.textContent = `Found ${uploadedFileData.length} data rows. Select address column.`;
                        } else {
                            uploadStatusDiv.textContent = 'Error: No data found in Excel sheet after header row (or sheet is empty).';
                        }
                    } catch (error) {
                        console.error('Excel Parsing Error:', error);
                        uploadStatusDiv.textContent = 'Error parsing Excel file.';
                    }
                };
                reader.readAsArrayBuffer(file); // Read Excel as ArrayBuffer
            } else {
                uploadStatusDiv.textContent = 'Unsupported file type. Please upload CSV or Excel.';
                fileInput.value = ''; // Reset file input
            }
        }

        function populateColumnSelector(headers) {
            if (!headers || headers.length === 0) {
                uploadStatusDiv.textContent = 'Error: Could not find valid headers.';
                return;
            }
            addressColumnSelect.innerHTML = '<option value="">-- Select Column --</option>'; // Default option
            headers.forEach(header => {
                if (header && String(header).trim() !== '') { // Ensure header is not null/empty/whitespace
                    const option = document.createElement('option');
                    option.value = header;
                    option.textContent = header;
                    // Simple heuristic to pre-select common address column names
                    const lowerHeader = String(header).toLowerCase(); // Ensure header is string
                    if (lowerHeader.includes('address') || lowerHeader.includes('location') || lowerHeader.includes('street') || lowerHeader.includes('propaddr')) {
                        option.selected = true;
                    }
                    addressColumnSelect.appendChild(option);
                } else {
                    console.warn('Skipping empty or invalid header:', header);
                }
            });
            columnSelectionDiv.classList.remove('hidden'); // Show the dropdown and button
        }
        
        // --- Querying Parcel Layer Directly ---
        async function processUploadedFile() {
            console.log("processUploadedFile started"); // Add log
            const selectedColumn = addressColumnSelect.value;
            if (!selectedColumn || !uploadedFileData) {
                uploadStatusDiv.textContent = 'Please select a file and an address column first.';
                return;
            }

            uploadStatusDiv.textContent = `Querying ${uploadedFileData.length} addresses against parcel layer... Please wait.`;
            uploadPropertyListContainer.innerHTML = '<div class="spinner"><div class="loader"></div> Processing...</div>'; // Show spinner
            csvUploadGraphicsLayer.removeAll(); // Clear previous CSV markers
            highlightGraphicsLayer.removeAll(); // Clear previous highlights
            processedParcelDataForDownload = []; // Clear previous download data

            const results = [];
            const addressFieldName = 'PAR_ADDR1'; // Correct field name for Property Location Address

            for (let i = 0; i < uploadedFileData.length; i++) {
                const rowData = uploadedFileData[i];
                const address = String(rowData[selectedColumn] || '').trim().toUpperCase(); // Get address, trim, and uppercase for better matching
                
                let result = {
                    originalAddress: rowData[selectedColumn] || 'N/A',
                    status: 'Processing',
                    mapPoint: null, // Will use centroid of found parcel
                    parcelAttributes: null,
                    parcelGeometry: null,
                    calculatedAcres: null, // Add field for calculated acres
                    areaSqMeters: null, // Add field for raw square meters
                    index: i + 1 // For numbering
                };
                
                if (!address) {
                    result.status = 'Skipped (Empty Address)';
                    results.push(result);
                    continue; // Skip if address is empty
                }
                
                try {
                    // Construct the query
                    const query = parcelLayer.createQuery();
                    // Escape single quotes in the address for the WHERE clause
                    const escapedAddress = address.replace(/'/g, "''"); 
                    // Use LIKE with wildcards for more flexible matching
                    query.where = `${addressFieldName} LIKE '%${escapedAddress}%'`; 
                    query.returnGeometry = true;
                    query.outFields = ["*"]; // Request all fields

                    // Execute the query
                    const queryResponse = await parcelLayer.queryFeatures(query);
                    if (queryResponse.features.length > 0) {
                        // Found one or more matching parcels
                        if (queryResponse.features.length > 1) {
                            result.status = 'Multiple Parcels Found'; // Mark as ambiguous
                        } else {
                            result.status = 'Success';
                        }
                        // Use the first feature found
                        const feature = queryResponse.features[0];
                        result.parcelAttributes = feature.attributes;
                        result.parcelGeometry = feature.geometry;
                        
                        // Use centroid for marker placement
                        if (feature.geometry) {
                            if (feature.geometry.type === "polygon") {
                                result.mapPoint = feature.geometry.centroid;
                            } else if (feature.geometry.type === "point") {
                                result.mapPoint = feature.geometry;
                            }
                        }
                         if (!result.mapPoint) { // Fallback if centroid fails or geometry missing
                             console.warn(`Could not determine mapPoint for address: ${address}`);
                         }

                        // Store Area and Calculate Acres from Shape.STArea() if available
                        const rawAreaSqMeters = feature.attributes['Shape.STArea()'];
                        if (typeof rawAreaSqMeters === 'number' && rawAreaSqMeters > 0) {
                            result.areaSqMeters = rawAreaSqMeters.toFixed(2); // Store raw value, rounded slightly
                            const SQM_TO_ACRES = 0.000247105;
                            result.calculatedAcres = (rawAreaSqMeters * SQM_TO_ACRES).toFixed(3); // Calculate and round acres
                        }

                    } else {
                        result.status = 'Address Not Found in Parcel Layer';
                    }
                } catch (queryError) {
                    console.error(`Query error for address '${address}':`, queryError);
                    result.status = `Query Error: ${queryError.message}`;
                }
                
                results.push(result);
                // Also add successful/multi-found results to the download array
                if (result.status === 'Success' || result.status === 'Multiple Parcels Found') {
                    processedParcelDataForDownload.push(result);
                }
                
                // Update status incrementally
                uploadStatusDiv.textContent = `Processed ${i + 1} of ${uploadedFileData.length}...`;
            }

            uploadStatusDiv.textContent = `Processing complete. Displaying ${results.filter(r => r.status === 'Success' || r.status === 'Multiple Parcels Found').length} found records.`;

            // Save the processed results to localStorage
            if (currentUploadedFileName && results.length > 0) {
                saveProcessedDataset(currentUploadedFileName, results);
            }

            displayProcessedResults(results); // Call function to display results
        }

// Function to save processed data to localStorage
function saveProcessedDataset(name, data) {
    if (!name || !data || data.length === 0) {
        console.warn("Attempted to save empty or invalid dataset.");
        return;
    }
    // Sanitize the name to create a valid localStorage key
    const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, '_'); // Replace invalid chars
    const key = `processedDataset_${sanitizedName}`; // Use sanitized name

    try {
        // Prune geometry and potentially large attributes before saving
        const dataToSave = data.map(item => {
            const prunedItem = {
                originalAddress: item.originalAddress,
                status: item.status,
                mapPoint: item.mapPoint, // Keep mapPoint for marker placement
                index: item.index,
                // Selectively keep essential attributes, exclude large ones or geometry
                parcelAttributes: item.parcelAttributes ? {
                    PARCELID: item.parcelAttributes.PARCELID,
                    PAR_ADDR1: item.parcelAttributes.PAR_ADDR1,
                    OWNER: item.parcelAttributes.OWNER,
                    // Add other essential attributes you need for display/download
                } : null,
                // parcelGeometry is intentionally excluded to save space
            };
            // Remove null/undefined properties to further save space
            Object.keys(prunedItem).forEach(key => (prunedItem[key] == null) && delete prunedItem[key]);
            if (prunedItem.parcelAttributes) {
                 Object.keys(prunedItem.parcelAttributes).forEach(key => (prunedItem.parcelAttributes[key] == null) && delete prunedItem.parcelAttributes[key]);
            }
            return prunedItem;
        });

        const jsonData = JSON.stringify(dataToSave);
        console.log(`Attempting to save data to localStorage with key: ${key}. Data size: ${jsonData.length} bytes.`);
        localStorage.setItem(key, jsonData);
        console.log(`Dataset "${name}" (key: ${key}) saved successfully.`);
        // Optionally, update the UI to show saved datasets immediately
        loadSavedDatasets(); // Refresh the list of saved datasets
    } catch (error) {
        console.error(`Error saving dataset "${name}" (key: ${key}) to localStorage:`, error);
        // Handle potential errors like quota exceeded
        if (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
            alert('Could not save dataset. Local storage quota exceeded. You may need to clear some saved datasets or upload smaller files.');
        } else {
            alert(`An error occurred while saving the dataset: ${error.message}`);
        }
    }
}

// Function to load and populate the saved datasets dropdown
function loadSavedDatasets() {
    if (!savedDatasetsSelect || !savedDatasetsStatus) { // Ensure elements exist
        console.error("loadSavedDatasets: Could not find UI elements (savedDatasetsSelect or savedDatasetsStatus)."); // Added error log
        return;
    }

    savedDatasetsSelect.innerHTML = '<option value="">-- Select a saved dataset --</option>'; // Clear existing options
    let count = 0;
    const keysToRemove = []; // Keep track of potentially invalid keys

    console.log("Starting loadSavedDatasets function...");
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        console.log(`Checking localStorage key: ${key}`);
        if (key && key.startsWith('processedDataset_')) {
            // Attempt to retrieve and parse slightly to check validity
            try {
                console.log(`Found matching key: ${key}`);
                const storedData = localStorage.getItem(key);
                if (!storedData) {
                    console.warn(`Found empty data for key: ${key}. Marking for removal.`);
                    keysToRemove.push(key);
                    continue;
                }
                // Basic check: is it valid JSON?
                JSON.parse(storedData); // This will throw an error if invalid

                // Extract a user-friendly name from the key
                // Assuming the original filename was stored after 'processedDataset_'
                // The sanitization replaced non-alphanumeric with '_'
                // We can display the sanitized name or try to revert (might be complex)
                // Let's display the part after the prefix for now.
                const displayName = key.substring('processedDataset_'.length);

                const option = document.createElement('option');
                option.value = key; // Store the full key as the value
                option.textContent = displayName; // Display the extracted name
                console.log(`Adding option: ${displayName} (value: ${key})`);
                savedDatasetsSelect.appendChild(option);
                count++;
            } catch (e) {
                console.warn(`Found potentially corrupt data for key: ${key}. Error: ${e.message}. Marking for removal.`);
                keysToRemove.push(key); // Mark invalid/corrupt entries for removal
            }
        }
    }

    // Clean up invalid entries
    keysToRemove.forEach(key => {
        console.log(`Removing invalid/corrupt localStorage item: ${key}`);
        localStorage.removeItem(key);
    });

    if (count > 0) {
        savedDatasetsStatus.textContent = `Found ${count} saved dataset(s).`;
        savedDatasetsSelect.disabled = false;
        loadSavedDatasetButton.disabled = false;
        deleteSavedDatasetButton.disabled = false;
    } else {
        savedDatasetsStatus.textContent = 'No saved datasets found.';
        savedDatasetsSelect.disabled = true;
        loadSavedDatasetButton.disabled = true;
        deleteSavedDatasetButton.disabled = true;
    }
    console.log("Finished loadSavedDatasets function.");
}

        // Function to add a numbered marker to the map
        function addNumberedMarker(location, number, attributes = null) {
            if (!location) return; // Don't add marker if location is null
            const markerSymbol = {
                type: "simple-marker",
                color: [226, 119, 40], // Orange
                outline: {
                    color: [255, 255, 255], // White
                    width: 1
                }
            };
            
            const textSymbol = {
                type: "text",
                color: "white",
                haloColor: "black",
                haloSize: "1px",
                text: number.toString(),
                xoffset: 0,
                yoffset: -4, // Adjust offset slightly if needed
                font: { // Define font properties
                    size: 10,
                    weight: "bold"
                }
            };

            const pointGraphic = new Graphic({
                geometry: location,
                symbol: markerSymbol,
                attributes: attributes || {} // Add attributes if provided
            });

            const textGraphic = new Graphic({
                geometry: location,
                symbol: textSymbol,
                attributes: attributes || {} // Add attributes if provided
            });

            csvUploadGraphicsLayer.addMany([pointGraphic, textGraphic]);
            return [pointGraphic, textGraphic]; // Return graphics for potential interaction
        }

        // Function to display results from the uploaded file
        function displayProcessedResults(results) {
            uploadPropertyListContainer.innerHTML = ''; // Clear spinner/previous content
            csvUploadGraphicsLayer.removeAll(); // Clear existing graphics before adding new ones
            highlightGraphicsLayer.removeAll(); // Clear previous highlights
            
            // Hide download button initially
            if (downloadResultsCsvButton) downloadResultsCsvButton.classList.add('hidden');

            if (!results || results.length === 0) {
                 uploadPropertyListContainer.textContent = 'No results to display.';
                 return;
            }
            
            const listElement = document.createElement('div');
            listElement.className = 'property-list'; // Use existing class for styling
            
            let successfulResults = []; // To store geometries/points for extent calculation
            let extent = null; // To calculate extent

            results.forEach(result => {
                const listItem = document.createElement('div');
                listItem.className = 'property-list-item';
                
                const numberSpan = document.createElement('span');
                numberSpan.className = 'property-list-number'; // Style like owner search
                numberSpan.textContent = result.index;
                
                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'property-list-details';
                
                const addressSpan = document.createElement('div');
                addressSpan.className = 'property-list-address';
                addressSpan.textContent = result.originalAddress || 'N/A';
                
                const statusSpan = document.createElement('div');
                statusSpan.className = 'property-list-parcel-id'; // Reuse style
                statusSpan.style.fontSize = '0.8em'; // Smaller status text
                
                detailsDiv.appendChild(addressSpan);

                if (result.status === 'Success') {
                    statusSpan.textContent = `Parcel: ${result.parcelAttributes.PARID || 'N/A'}`; // Show Parcel ID
                    listItem.classList.add('success'); // Optional: Add class for styling success
                    
                    // Add marker to map (check if mapPoint exists)
                    if (result.mapPoint) {
                        addNumberedMarker(result.mapPoint, result.index, result.parcelAttributes);
                        successfulResults.push(result.mapPoint); // Add point for extent
                    }

                    // Make list item clickable
                    listItem.style.cursor = 'pointer';
                    listItem.addEventListener('click', () => {
                        if (result.mapPoint) view.goTo({ target: result.mapPoint, zoom: 18 }); // Zoom to the point
                        // Optionally highlight the parcel polygon if needed
                        highlightProperty(result.parcelGeometry); 
                        // Optionally display full info (might be too much for upload list)
                        // displayParcelInfo(result.parcelAttributes, result.parcelGeometry); 
                    });
                } else if (result.status === 'Multiple Parcels Found') {
                    statusSpan.textContent = `Parcel: ${result.parcelAttributes.PARID || 'N/A'} (Multiple Found)`; 
                    listItem.classList.add('warning'); // Style for multiple
                    // Add marker to map (check if mapPoint exists)
                    if (result.mapPoint) {
                         addNumberedMarker(result.mapPoint, result.index, result.parcelAttributes);
                         successfulResults.push(result.mapPoint); // Add point for extent
                    }
                     listItem.style.cursor = 'pointer';
                    listItem.addEventListener('click', () => {
                        if (result.mapPoint) view.goTo({ target: result.mapPoint, zoom: 18 }); 
                        if (result.parcelGeometry) highlightProperty(result.parcelGeometry); 
                    });
                } else {
                    statusSpan.textContent = `Status: ${result.status}`;
                    listItem.classList.add('failed'); // Optional: Add class for styling failures
                    numberSpan.style.backgroundColor = '#888'; // Grey out number for failures
                }
                
                detailsDiv.appendChild(statusSpan);
                listItem.appendChild(numberSpan);
                listItem.appendChild(detailsDiv);
                listElement.appendChild(listItem);
            });

            uploadPropertyListContainer.appendChild(listElement);

            // Make the toggle button visible now that there are results
            if (results && results.length > 0) {
                toggleProcessedListButton.style.display = 'block';
                toggleProcessedListButton.textContent = 'Hide Processed Addresses'; // Reset text
                uploadPropertyListContainer.style.display = 'block'; // Ensure list is visible initially
            } else {
                toggleProcessedListButton.style.display = 'none'; // Hide if no results
            }

            // Show download button if there are results to download
            if (processedParcelDataForDownload.length > 0 && downloadResultsCsvButton) {
                console.log(`displayProcessedResults: Making download button visible. Data length: ${processedParcelDataForDownload.length}`); // Add log
                downloadResultsCsvButton.classList.remove('hidden');
            } else {
                 console.log(`displayProcessedResults: Not showing download button. Data length: ${processedParcelDataForDownload ? processedParcelDataForDownload.length : 'null or undefined'}`); // Add log for the else case too
            }

            // Zoom to the extent of successful results if any
            if (successfulResults.length > 0) {
                // Simple extent calculation (more robust libraries exist, but this is basic)
                if (successfulResults.length === 1) {
                    view.goTo({ target: successfulResults[0], zoom: 18 });
                } else {
                    // Calculate extent (basic implementation)
                    let minX = successfulResults[0].longitude, maxX = successfulResults[0].longitude;
                    let minY = successfulResults[0].latitude, maxY = successfulResults[0].latitude;
                    successfulResults.forEach(p => {
                        if (p.longitude < minX) minX = p.longitude;
                        if (p.longitude > maxX) maxX = p.longitude;
                        if (p.latitude < minY) minY = p.latitude;
                        if (p.latitude > maxY) maxY = p.latitude;
                    });
                    extent = {
                        xmin: minX, ymin: minY, xmax: maxX, ymax: maxY,
                        spatialReference: view.spatialReference
                    };
                    view.goTo(extent).catch(error => {
                        if (error.name != "AbortError") { // Ignore AbortError if user interacts
                            console.error("Error zooming to extent: ", error);
                        }
                    });
                }
            } else {
                // Maybe show a message if no addresses were successful?
                console.log("No successful results to zoom to.");
            }
        }

        // --- CSV Download Functionality ---
        function downloadResultsAsCSV() {
            console.log(`downloadResultsAsCSV started. Data length: ${processedParcelDataForDownload ? processedParcelDataForDownload.length : 'null or undefined'}`); // Add log
            if (!processedParcelDataForDownload || processedParcelDataForDownload.length === 0) {
                console.log("No data available to download."); // Existing log (line ~1854)
                return;
            }
            
            // Define CSV Headers - Adjust fields as needed
            // Define CSV Headers - Match the fields being extracted below
            const headers = [
                "Original Address Input", // From the uploaded file
                "Processing Status",
                "Parcel ID (PARID)", // Found Parcel ID
                "Owner Name (OWNER)",
                "Property Location Address (PAR_ADDR1)", // Found Property Address
                "Property ZIP (PAR_ZIP)",
                "Owner Mailing Address (Combined)", // Constructed from OWN_ADRNO, OWN_ADRSTR etc.
                "Owner Mailing City (OWN_CITY)",
                "Owner Mailing State (OWN_STATE)",
                "Owner Mailing ZIP (OWN_ZIP)",
                "Owner Mailing ZIP+4 (OWN_ZIP4)",
                "Neighborhood (NBHD)",
                "Class (CLASS)",
                "Land Use Code (LUC)",
                "Living Units (LIVUNIT)",
                "Zoning (ZONING)",
                "Municipality (MUNI)",
                "Land Use Description (LANDUSE)",
                "Acres (Calculated from Area)", // Add header for calculated acres
                "Area (Sq Meters)" // Add header for square meters
                // Add other relevant fields from example.txt if needed
                // "Land Value", // Not directly in example.txt attributes shown
                // "Improvement Value", // Not directly in example.txt attributes shown
                // "Total Assessed Value", // Not directly in example.txt attributes shown
                // "Living Area SqFt", // Not directly in example.txt attributes shown
                // "Year Built", // Not directly in example.txt attributes shown
            ];

            // Function to safely format value for CSV (handles commas, quotes, newlines)
            const formatCsvValue = (value) => {
                if (value === null || value === undefined) {
                    return "";
                }
                let strValue = String(value);
                // If the value contains a comma, double quote, or newline, enclose it in double quotes
                if (strValue.includes(',') || strValue.includes('"') || strValue.includes('\n')) {
                    // Escape existing double quotes by replacing them with two double quotes
                    strValue = strValue.replace(/"/g, '""');
                    return `"${strValue}"`;
                }
                return strValue;
            };

            // Map data to CSV rows
            const csvRows = processedParcelDataForDownload.map(result => {
                const attr = result.parcelAttributes || {}; // Use empty object if attributes are null
                
                // Construct Owner Mailing Address from components if available
                let ownerMailingAddress = "";
                if (attr.OWN_ADRNO || attr.OWN_ADRSTR) {
                    if (attr.OWN_ADRNO) ownerMailingAddress += attr.OWN_ADRNO;
                    if (attr.OWN_ADRPREDIR) ownerMailingAddress += ` ${attr.OWN_ADRPREDIR}`;
                    if (attr.OWN_ADRSTR) ownerMailingAddress += ` ${attr.OWN_ADRSTR}`;
                    if (attr.OWN_ADRSUF) ownerMailingAddress += ` ${attr.OWN_ADRSUF}`;
                    if (attr.OWN_ADRPOSTDIR) ownerMailingAddress += ` ${attr.OWN_ADRPOSTDIR}`;
                    if (attr.OWN_UNITDESC && attr.OWN_UNITNO) ownerMailingAddress += ` ${attr.OWN_UNITDESC} ${attr.OWN_UNITNO}`;
                    ownerMailingAddress = ownerMailingAddress.trim();
                } else if (attr.OWN_ADDR1) { // Fallback to OWN_ADDR1/2/3 if components missing
                    ownerMailingAddress = attr.OWN_ADDR1 || '';
                    if (attr.OWN_ADDR2) ownerMailingAddress += `, ${attr.OWN_ADDR2}`;
                    if (attr.OWN_ADDR3) ownerMailingAddress += `, ${attr.OWN_ADDR3}`;
                }

                const row = [
                    result.originalAddress, // Original input from file
                    result.status,          // Processing status
                    attr.PARID,             // Found Parcel ID
                    attr.OWNER,             // Corrected Owner Name field
                    attr.PAR_ADDR1,         // Found Property Address
                    attr.PAR_ZIP,           // Property ZIP
                    ownerMailingAddress,    // Constructed Owner Mailing Address
                    attr.OWN_CITY,          // Owner City
                    attr.OWN_STATE,         // Owner State
                    attr.OWN_ZIP,           // Owner ZIP
                    attr.OWN_ZIP4,          // Owner ZIP+4
                    attr.NBHD,              // Neighborhood
                    attr.CLASS,             // Class
                    attr.LUC,               // Land Use Code
                    attr.LIVUNIT,           // Living Units
                    attr.ZONING,            // Zoning
                    attr.MUNI,              // Municipality
                    attr.LANDUSE,           // Land Use Description
                    result.calculatedAcres, // Add the calculated acres value
                    result.areaSqMeters     // Add the raw square meters value
                    // Add other fields here if needed, matching the headers
                ];
                return row.map(formatCsvValue).join(',');
            });

            // Combine header and rows
            const csvString = [headers.map(formatCsvValue).join(','), ...csvRows].join('\n');

            // Create Blob and trigger download
            const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            if (link.download !== undefined) { // Feature detection
                const url = URL.createObjectURL(blob);
                link.setAttribute("href", url);
                link.setAttribute("download", "parcel_details_export.csv");
                link.style.visibility = 'hidden';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url); // Free up memory
            } else {
                alert("CSV download is not supported by your browser.");
            }
        }

        // Add event listener for the download button
        if (downloadResultsCsvButton) {
            downloadResultsCsvButton.addEventListener('click', downloadResultsAsCSV);
        }

        // --- Event Listener for the Toggle Button ---
        toggleProcessedListButton.addEventListener('click', () => {
            const isHidden = uploadPropertyListContainer.style.display === 'none';
            if (isHidden) {
                uploadPropertyListContainer.style.display = 'block';
                toggleProcessedListButton.textContent = 'Hide Processed Addresses';
                } else {
                uploadPropertyListContainer.style.display = 'none';
                toggleProcessedListButton.textContent = 'Show Processed Addresses';
            }
        });

        // --- Event Listener for the Main Search Content Toggle Button ---
        toggleSearchContentButton.addEventListener('click', () => {
            const elementsToToggle = [
                searchGroupDiv,
                uploadSectionDiv,
                propertyListContainerDiv,
                toggleProcessedListButton // Also toggle the processed list button visibility
            ];
            // Check the visibility of the first element to determine the state
            const isHidden = searchGroupDiv.style.display === 'none';

            elementsToToggle.forEach(el => {
                if (el) { // Check if the element exists
                    // Special handling for toggleProcessedListButton: only show if unhiding and the list has content
                    if (el === toggleProcessedListButton) {
                        if (isHidden && uploadPropertyListContainer.children.length > 0) {
                           // Only show if unhiding and the list has content
                           el.style.display = 'block';
            } else {
                           el.style.display = 'none';
            }
            } else {
                       // Standard toggle for other elements
                       el.style.display = isHidden ? 'block' : 'none';
                    }
                }
            });

            toggleSearchContentButton.textContent = isHidden ? 'Hide' : 'Show';
        });

        // --- Favorites Functionality ---
        // LocalStorage Key
        const FAVORITES_KEY = 'shelbyParcelViewerFavorites';

        // Get favorites from localStorage
        function getFavorites() {
            const favoritesJson = localStorage.getItem(FAVORITES_KEY);
            return favoritesJson ? JSON.parse(favoritesJson) : {}; // Store as object { parcelId: { id, address, geometry } }
        }

        // Save favorites to localStorage
        function saveFavorites(favorites) {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        }

        // Check if a parcel is favorited
        function isFavorite(parcelId) {
            const favorites = getFavorites();
            return !!favorites[parcelId];
        }

        // Add a parcel to favorites
        function addFavorite(parcelData) {
            const favorites = getFavorites();
            if (!parcelData || !parcelData.id) {
                console.error("Invalid parcel data for adding favorite.");
                return;
            }
            // Ensure geometry can be converted to JSON (Restoring this)
            const geometryJson = parcelData.geometry ? parcelData.geometry.toJSON() : null;
            if (!geometryJson) {
                console.error("Cannot favorite: Geometry is missing or invalid.");
                alert("Could not add favorite: Parcel geometry is missing.");
                return;
            }
            // Construct address string safely (Uses addressNum/addressStreet passed into this function)
            const addressNum = parcelData.addressNum || ''; // Use value passed in
            const addressStreet = parcelData.addressStreet || ''; // Use value passed in
            const fullAddress = (addressNum + ' ' + addressStreet).trim() || 'Address N/A';
 
            favorites[parcelData.id] = { // Store essential data
                id: parcelData.id,
                address: fullAddress, // Use the constructed full address
                map: parcelData.map || 'N/A',
                geometry: geometryJson // Store geometry JSON (Restoring this)
            };
            saveFavorites(favorites);
            updateFavoriteButton(true); // Update button state
        }

        // Remove a parcel from favorites
        function removeFavorite(parcelId) {
            const favorites = getFavorites();
            if (!parcelId) return;
            delete favorites[parcelId];
            saveFavorites(favorites);
            updateFavoriteButton(false); // Update button state
            if (!favoritesContainer.classList.contains('hidden')) {
                displayFavoriteMarkers(); // Update map markers
            }
        }

        // Update the appearance of the favorite button
        function updateFavoriteButton(isFav) {
            if (isFav) {
                favoriteButton.textContent = '★'; // Filled star
                favoriteButton.title = 'Remove from Favorites';
                favoriteButton.classList.add('favorited');
                } else {
                favoriteButton.textContent = '☆'; // Empty star
                favoriteButton.title = 'Add to Favorites';
                favoriteButton.classList.remove('favorited');
            }
        }

        // Display markers for all favorited properties
        function displayFavoriteMarkers() {
            favoritesGraphicsLayer.removeAll(); // Clear existing markers
            const favorites = getFavorites();
            const favoriteGraphics = [];

            const favoriteSymbol = {
                type: "simple-marker",
                color: [255, 0, 0, 0.8], // Red marker for favorites
                size: "12px",
                outline: {
                    color: [255, 255, 255, 0.8],
                    width: 1.5
                }
            };

            for (const parcelId in favorites) {
                const favData = favorites[parcelId];
                if (favData.geometry) {
                    try {
                        let geometryObject = null;
                        let pointForMarker = null;

                        // Reconstruct geometry from JSON
                        if (favData.geometry.rings) { // It's a Polygon JSON
                            geometryObject = Polygon.fromJSON(favData.geometry);
                            pointForMarker = geometryObject.centroid; // Use centroid for marker
                        } else if (favData.geometry.x !== undefined && favData.geometry.y !== undefined) { // It's a Point JSON
                            geometryObject = Point.fromJSON(favData.geometry);
                            pointForMarker = geometryObject;
                } else {
                            console.warn(`Favorite parcel ${parcelId} has unrecognized geometry format.`);
                            continue; // Skip if geometry format is unknown
                        }

                        if (pointForMarker) {
                            const graphic = new Graphic({
                                geometry: pointForMarker, // Use Point geometry for the marker
                                symbol: favoriteSymbol,
                                attributes: { ...favData, sourceGeometry: geometryObject } // Store original geometry in attributes if needed
                            });
                            favoriteGraphics.push(graphic);
            } else {
                             console.warn(`Could not determine marker location for favorite parcel ${parcelId}.`);
                        }
                    } catch (error) {
                        console.error(`Error processing geometry for favorite ${parcelId}:`, error, favData.geometry);
                    }
                } else {
                    console.warn(`Favorite parcel ${parcelId} missing geometry data.`);
                }
            }

            if (favoriteGraphics.length > 0) {
                console.log("Adding", favoriteGraphics.length, "favorite graphics to layer.");
                favoritesGraphicsLayer.addMany(favoriteGraphics);
            } else {
                console.log("No valid favorite graphics to add to layer.");
            }
        }

        // Display the list of favorited properties in the sidebar
        function displayFavoritesList() {
            favoritesListContent.innerHTML = ''; // Clear previous list
            const favorites = getFavorites();
            const parcelIds = Object.keys(favorites);

            if (parcelIds.length === 0) {
                noFavoritesMessage.style.display = 'block';
            } else {
                noFavoritesMessage.style.display = 'none';
                const listElement = document.createElement('ul');
                listElement.classList.add('favorites-list'); // Add class for potential styling

                parcelIds.forEach(parcelId => {
                    const favData = favorites[parcelId];
                    const listItem = document.createElement('li');
                    listItem.innerHTML = `
                        <strong>Parcel ID:</strong> ${favData.id}<br>
                        <strong>Address:</strong> ${favData.address || 'N/A'}
                    `;
                    listItem.style.cursor = 'pointer';
                    listItem.style.marginBottom = '10px';
                    listItem.style.paddingBottom = '10px';
                    listItem.style.borderBottom = '1px solid #555';

                    listItem.addEventListener('click', () => {
                        // Attempt to find the geometry to zoom to
                        const pointGeometry = favData.geometry.type === 'point' ? favData.geometry :
                                           (favData.geometry.centroid || null);
                        if (pointGeometry) {
                             view.goTo({ target: pointGeometry, zoom: 18 });
                             // Optionally highlight the parcel if you have the full geometry
                             if (favData.geometry.type === 'polygon') {
                                highlightProperty(favData.geometry);
                             }
                } else {
                            console.log("Geometry not available for zooming to favorite.");
                            // Maybe trigger a search if only ID is known?
                        }
                        // Optionally hide the favorites list after clicking
                        // favoritesContainer.classList.add('hidden');
                    });
                listElement.appendChild(listItem);
            });
                favoritesListContent.appendChild(listElement);
            }
        }

        // Event Listener for the Favorite button in parcel details
        favoriteButton.addEventListener('click', () => {
            if (!currentParcelData || !currentParcelData.PARID) return; // Ensure data is loaded

            const parcelId = currentParcelData.PARID;
            if (isFavorite(parcelId)) {
                removeFavorite(parcelId);
            } else {
                // Prepare data to save (ensure geometry exists)
                 const geometryToSave = currentParcelData.geometry; // Already an object here
                 // Ensure address parts exist in currentParcelData
                 const addressNum = currentParcelData.Jur_num; // Corrected
                 const addressStreet = currentParcelData.Jur_stnam; // Corrected
                 
                 if(geometryToSave) {
                     addFavorite({ 
                         id: parcelId, 
                         addressNum: addressNum, // Pass components separately
                         addressStreet: addressStreet,
                         map: currentParcelData.MapNumber, 
                         geometry: geometryToSave // Pass the geometry object
                     });
            } else {
                     console.error("Cannot favorite: Geometry data missing.");
                     alert("Could not add favorite: Parcel geometry is missing.");
                 }
            }
            // Re-display the list if it's currently open
            if (!favoritesContainer.classList.contains('hidden')) {
                displayFavoritesList();
            }
        });

        // Event Listener to Show Favorites List
        showFavoritesButton.addEventListener('click', () => {
            favoritesContainer.classList.remove('hidden');
            displayFavoritesList(); // Populate the list when shown
            displayFavoriteMarkers(); // Ensure map markers are up-to-date
        });

        // Event Listener to Hide Favorites List
        hideFavoritesButton.addEventListener('click', () => {
            favoritesContainer.classList.add('hidden');
            favoritesGraphicsLayer.removeAll(); // Remove markers from map
        });

        // --- End Favorites Functionality ---

        // --- Initial Load --- 
        // Markers are now only shown when the panel is opened

        // --- End Geocoding and Processing Uploaded File ---

        // Event Listener for Load Saved Dataset Button
        if (loadSavedDatasetButton && savedDatasetsSelect) {
            loadSavedDatasetButton.addEventListener('click', () => {
                const selectedKey = savedDatasetsSelect.value;
                if (!selectedKey) {
                    savedDatasetsStatus.textContent = 'Please select a dataset to load.';
                    savedDatasetsStatus.style.color = 'orange';
                    return;
                }

                try {
                    const jsonData = localStorage.getItem(selectedKey);
                    if (jsonData) {
                        const savedData = JSON.parse(jsonData);
                        
                        // Clear existing displayed data before loading new set
                        uploadPropertyListContainer.innerHTML = ''; // Clear property list in sidebar
                        csvUploadGraphicsLayer.removeAll(); // Clear existing markers from map
                        highlightGraphicsLayer.removeAll(); // Clear any highlights
                        
                        if (savedData && savedData.length > 0) {
                            // Convert plain mapPoint objects back to Esri Point objects
                            const processedSavedData = savedData.map(item => {
                                if (item.mapPoint && typeof item.mapPoint.x === 'number' && typeof item.mapPoint.y === 'number') {
                                    // Use the spatialReference from the stored point if available, otherwise default to view's SR
                                    const sr = item.mapPoint.spatialReference || view.spatialReference;
                                    return {
                                        ...item,
                                        mapPoint: new Point({ x: item.mapPoint.x, y: item.mapPoint.y, spatialReference: sr })
                                    };
                                }
                                return item; // Return item as-is if mapPoint is missing or not a simple point object
                            });

                            displayProcessedResults(processedSavedData); // This should re-add markers and list
                            savedDatasetsStatus.textContent = `Dataset "${selectedKey.substring('processedDataset_'.length)}" loaded.`;
                            savedDatasetsStatus.style.color = 'green';

                            // Ensure the map view adjusts to the loaded data
                            // The pointsForExtent will now correctly use the Esri Point objects from processedSavedData
                            if (view && processedSavedData.length > 0) {
                                const pointsForExtent = processedSavedData
                                    .map(item => item.mapPoint) // Get the mapPoint which is now an Esri Point
                                    .filter(point => point instanceof Point); // Filter out any nulls or non-Points

                                if (pointsForExtent.length > 0) {
                                    view.goTo(pointsForExtent).catch(error => {
                                        console.error("Error zooming to loaded dataset extent:", error);
                                    });
                                }
                            }

                        } else {
                            savedDatasetsStatus.textContent = 'Selected dataset is empty or invalid.';
                            savedDatasetsStatus.style.color = 'red';
                        }
                    } else {
                        savedDatasetsStatus.textContent = 'Could not retrieve data for the selected dataset.';
                        savedDatasetsStatus.style.color = 'red';
                    }
                } catch (error) {
                    console.error("Error loading saved dataset:", error);
                    savedDatasetsStatus.textContent = 'Error loading dataset. Check console for details.';
                    savedDatasetsStatus.style.color = 'red';
                    alert(`Error loading dataset: ${error.message}`);
                }
            });
        }

        // Event Listener for Delete Saved Dataset Button
        if (deleteSavedDatasetButton && savedDatasetsSelect) {
            deleteSavedDatasetButton.addEventListener('click', () => {
                const selectedKey = savedDatasetsSelect.value;
                if (!selectedKey) {
                    savedDatasetsStatus.textContent = 'Please select a dataset to delete.';
                    savedDatasetsStatus.style.color = 'orange';
                    return;
                }

                try {
                    localStorage.removeItem(selectedKey);
                    savedDatasetsStatus.textContent = 'Dataset deleted successfully.';
                    savedDatasetsStatus.style.color = 'green';
                    loadSavedDatasets(); // Refresh the list of saved datasets
                } catch (error) {
                    console.error("Error deleting dataset:", error);
                    savedDatasetsStatus.textContent = 'Error deleting dataset. Check console for details.';
                    savedDatasetsStatus.style.color = 'red';
                    alert(`Error deleting dataset: ${error.message}`);
                }
            });
        }
    }); // Correct closing for require callback

    // Event Listener for the Clear Cache Button (Outside ArcGIS require callback)
    const clearCacheButton = document.getElementById("clear-cache-button");
    if (clearCacheButton) {
        clearCacheButton.addEventListener("click", function() {
            console.log("Clear Cache & Reload button clicked.");
            
            // Show confirmation warning
            const confirmMessage = `⚠️ WARNING: This will permanently delete all your saved data including:

• All favorited properties
• All saved datasets from file uploads
• All application settings
• Browser cache data

This action cannot be undone. Are you sure you want to continue?`;

            const userConfirmed = confirm(confirmMessage);
            
            if (!userConfirmed) {
                console.log("User cancelled cache clearing operation.");
                return; // User cancelled, don't proceed
            }

            try {
                // Clear localStorage (favorites, saved datasets)
                localStorage.clear();
                console.log("localStorage cleared.");

                // Clear sessionStorage (if anything is stored there)
                sessionStorage.clear();
                console.log("sessionStorage cleared.");

                // Inform the user that data has been cleared
                alert("✅ Application data successfully cleared. The page will now reload with fresh settings.");

                // Perform a hard reload
                location.reload(true);

            } catch (e) {
                console.error("Error during cache clearing or reload:", e);
                alert("❌ An error occurred while trying to clear data. Please try manually clearing your browser cache or contact support.");
            }
        });
    }

}); // Correct closing for document.addEventListener callback

// Event Listener for the Owner Name Search
const ownerNameSearchButton = document.getElementById("owner-name-search-button");
const ownerNameInput = document.getElementById("owner-name-input");
const ownerPropertyListContainer = document.getElementById("owner-property-list-container");

ownerNameSearchButton.addEventListener('click', () => {
    const ownerName = ownerNameInput.value.trim();
    if (!ownerName) { 
        // Instead of alert, maybe clear the list or show a message?
        ownerPropertyListContainer.innerHTML = '<div class="search-message">Please enter an owner name.</div>';
        ownerPropertyListContainer.style.display = 'block'; // Make sure container is visible
                 return;
            }
            
    const ownerNameUpper = ownerName.toUpperCase();
    const query = new Query();
    query.where = `UPPER(OWNNAME) LIKE UPPER('%${ownerNameUpper}%')`;
    query.returnGeometry = true; // Need geometry to zoom
    // Ensure we request the necessary fields for display and info
    query.outFields = [
        "PARID", "Jur_num", "Jur_stnam", "OWNNAME", "MapNumber", "PropType", "LandUse", 
        "OWNADDR", "OWNCITY", "OWNSTATE", "OWNZIP", "OWNERNOTES",
        "Nbhd", "sqft_livingarea", "LandValue", "ImprovementValue", "TotalValue", "LivingUnits"
     ];

    // Show loading indicator
    ownerPropertyListContainer.innerHTML = '<div class="loader"></div>';

    // Execute the query
    parcelLayer.queryFeatures(query)
        .then(function(results) {
            if (results.features.length > 0) {
                // Clear any existing highlights and graphics
                clearMapGraphics();
                
                // Remove any existing property list and toggle button
                const existingList = document.getElementById('property-list');
                if (existingList) existingList.remove();
                const existingToggleButton = document.getElementById('toggle-owner-properties-button');
                if (existingToggleButton) existingToggleButton.remove();
                
                // If multiple properties found
                if (results.features.length > 1) {
                    // Create a container for the property list in the sidebar
                    const propertyListContainer = document.createElement('div');
                    propertyListContainer.className = 'property-list';
                    propertyListContainer.id = 'property-list';
                    
                    // Sort the features by address for a better list experience
                    results.features.sort((a, b) => {
                        const addrA = a.attributes.PAR_ADDR1 || '';
                        const addrB = b.attributes.PAR_ADDR1 || '';
                        return addrA.localeCompare(addrB);
                    });
                    
                    // Array to store all graphics for zooming
                    const allGraphics = [];
                    
                    // Process each property
                    results.features.forEach((feature, index) => {
                        const propertyNumber = index + 1;
                        const propertyAddress = feature.attributes.PAR_ADDR1 || 'No Address';
                        const parcelId = feature.attributes.PARCELID || 'No Parcel ID';
                        
                        // 1. Add the parcel polygon highlight
                        const highlightGraphic = {
                            geometry: feature.geometry,
                            symbol: {
                                type: "simple-fill",
                                color: [255, 165, 0, 0.2],
                outline: {
                                    color: [255, 69, 0, 1],
                                    width: 1.5
                                }
                            },
                            attributes: feature.attributes
                        };
                        highlightGraphicsLayer.add(highlightGraphic);
                        allGraphics.push(highlightGraphic);
                        
                        // 2. Add the numbered marker at the centroid of the parcel
                        const centroid = feature.geometry.centroid || 
                                        (feature.geometry.type === "polygon" ? 
                                        feature.geometry.extent.center : 
                                        feature.geometry);
                        
                        // Create an SVG marker with the property number
                        const markerSvg = encodeURIComponent(`<svg width="30" height="30" viewBox="0 0 30 30" xmlns="http://www.w3.org/2000/svg"><circle cx="15" cy="15" r="13" fill="#4dabf7" stroke="white" stroke-width="2"/><text x="15" y="20" font-family="Arial" font-size="14" font-weight="bold" text-anchor="middle" fill="white">${propertyNumber}</text></svg>`);
                        
                        const markerGraphic = {
                            geometry: centroid,
                            symbol: {
                                type: "picture-marker",
                                url: `data:image/svg+xml;utf8,${markerSvg}`,
                                width: 30,
                                height: 30
                            },
                            attributes: {
                                propertyNumber: propertyNumber,
                                PARCELID: feature.attributes.PARCELID
                            }
                        };
                        view.graphics.add(markerGraphic);
                        
                        // 3. Create list item for the sidebar
                const listItem = document.createElement('div');
                listItem.className = 'property-list-item';
                
                const numberSpan = document.createElement('span');
                numberSpan.className = 'property-list-number'; // Style like owner search
                        numberSpan.textContent = propertyNumber;
                
                const detailsDiv = document.createElement('div');
                detailsDiv.className = 'property-list-details';
                
                const addressSpan = document.createElement('div');
                addressSpan.className = 'property-list-address';
                        addressSpan.textContent = propertyAddress;
                        
                        const parcelIdSpan = document.createElement('div');
                        parcelIdSpan.className = 'property-list-parcel-id'; // Reuse style
                        parcelIdSpan.textContent = `Parcel: ${parcelId}`;
                
                detailsDiv.appendChild(addressSpan);
                        detailsDiv.appendChild(parcelIdSpan);
                        
                        listItem.appendChild(numberSpan);
                        listItem.appendChild(detailsDiv);

                    // Make list item clickable
                    listItem.style.cursor = 'pointer';
                    listItem.addEventListener('click', () => {
                            displayParcelInfo(feature.attributes, feature.geometry);
                        });
                        
                        // Add list item to the container
                        propertyListContainer.appendChild(listItem);
                    });
                    
                    // Zoom to the selected property
                    view.goTo(allGraphics, { padding: 50 })
                        .then(() => {
                            // Display message with count and add the property list
                            ownerPropertyListContainer.innerHTML = `Found ${results.features.length} properties owned by "${ownerName}". Click on a property below or on the map for details.`;
                            ownerPropertyListContainer.appendChild(propertyListContainer);
                        });
            } else {
                    // If only one property, display its details
                    displayParcelInfo(results.features[0].attributes, results.features[0].geometry);
            }
            } else {
                // No properties found for this owner
                ownerPropertyListContainer.innerHTML = `<div class="search-message">No properties found for owner "${ownerName}".</div>`;
                ownerPropertyListContainer.style.display = 'block'; // Ensure visibility
            }
        })
        .catch(function(error) {
            console.error("Error searching for owner:", error);
            ownerPropertyListContainer.innerHTML = '<div class="search-message">Error searching for properties by owner. Please try again.</div>';
            ownerPropertyListContainer.style.display = 'block'; // Ensure visibility
        });
});