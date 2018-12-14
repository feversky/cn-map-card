import 'https://unpkg.com/leaflet-ant-path@1.1.2/dist/leaflet-ant-path.js?module';


window.L.Icon.Default.imagePath = "/static/images/leaflet";

const latitude_offset = -0.00205;
const longitude_offset = 0.00407;

const fireEvent = (node, type, detail, options) => {
  options = options || {};
  detail = detail === null || detail === undefined ? {} : detail;
  const event = new Event(type, {
    bubbles: options.bubbles === undefined ? true : options.bubbles,
    cancelable: Boolean(options.cancelable),
    composed: options.composed === undefined ? true : options.composed,
  });
  event.detail = detail;
  node.dispatchEvent(event);
  return event;
};

function setupLeafletMap(mapElement) {
  const map = window.L.map(mapElement);
  const style = document.createElement("link");
  style.setAttribute("href", "/static/images/leaflet/leaflet.css");
  style.setAttribute("rel", "stylesheet");
  mapElement.parentNode.appendChild(style);
  map.setView([51.505, -0.09], 10);

  window.L.tileLayer(
    'http://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      subdomains: "1234",
      minZoom: 5,
      maxZoom: 18,
    }
  ).addTo(map);

  return map;
}

function isValidEntityId(entityId) {
  return /^(\w+)\.(\w+)$/.test(entityId);
}

function processConfigEntities(entities) {
  if (!entities || !Array.isArray(entities)) {
    throw new Error("Entities need to be an array");
  }

  return entities.map((entityConf, index) => {
    if (
      typeof entityConf === "object" &&
      !Array.isArray(entityConf) &&
      entityConf.type
    ) {
      return entityConf;
    }

    if (typeof entityConf === "string") {
      entityConf = {
        entity: entityConf
      };
    } else if (typeof entityConf === "object" && !Array.isArray(entityConf)) {
      if (!entityConf.entity) {
        throw new Error(
          `Entity object at position ${index} is missing entity field.`
        );
      }
    } else {
      throw new Error(`Invalid entity specified at position ${index}.`);
    }

    if (!isValidEntityId(entityConf.entity)) {
      throw new Error(
        `Invalid entity ID at position ${index}: ${entityConf.entity}`
      );
    }

    return entityConf;
  });
}

function computeStateDomain(stateObj) {
  return stateObj.entity_id.substr(0, stateObj.entity_id.indexOf("."));
}

function computeObjectId(entityId) {
  return entityId.substr(entityId.indexOf(".") + 1);
}

function computeStateName(stateObj) {
  if (stateObj._entityDisplay === undefined) {
    stateObj._entityDisplay =
      stateObj.attributes.friendly_name ||
      computeObjectId(stateObj.entity_id).replace(/_/g, " ");
  }

  return stateObj._entityDisplay;
}

function debounce(func, wait, immediate) {
  let timeout;
  return function (...args) {
    const context = this;
    const later = () => {
      timeout = null;
      if (!immediate) func.apply(context, args);
    };
    const callNow = immediate && !timeout;
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
    if (callNow) func.apply(context, args);
  };
}

class CNMapCard extends Polymer.Element {
  static get template() {
    return Polymer.html `
      <style>
        :host([is-panel]) ha-card {
          left: 0;
          top: 0;
          width: 100%;
          /**
           * In panel mode we want a full height map. Since parent #view
           * only sets min-height, we need absolute positioning here
           */
          height: 100%;
          position: absolute;
        }

        ha-card {
          overflow: hidden;
        }

        #map {
          z-index: 0;
          border: none;
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }

        paper-icon-button {
          position: absolute;
          top: 75px;
          left: 7px;
        }

        #root {
          position: relative;
        }

        :host([is-panel]) #root {
          height: 100%;
        }
      </style>

      <ha-card id="card" header="[[_config.title]]">
        <div id="root">
          <div id="map"></div>
          <paper-icon-button
            on-click="_fitMap"
            icon="hass:image-filter-center-focus"
            title="Reset focus"
          ></paper-icon-button>
        </div>
      </ha-card>

    `;
  }

  static get properties() {
    return {
      hass: {
        type: Object,
        observer: "_drawEntities",
      },
      _config: Object,
      isPanel: {
        type: Boolean,
        reflectToAttribute: true,
      },
    };
  }

  constructor() {
    super();
    this._debouncedResizeListener = debounce(this._resetMap.bind(this), 100);
  }

  ready() {
    super.ready();

    if (!this._config || this.isPanel) {
      return;
    }

    this.$.root.style.paddingTop = this._config.aspect_ratio || "100%";
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Error in card configuration.");
    }

    this._configEntities = processConfigEntities(config.entities);
    this._config = config;
  }

  getCardSize() {
    let ar = this._config.aspect_ratio || "100%";
    ar = ar.substr(0, ar.length - 1);
    return 1 + Math.floor(ar / 25) || 3;
  }

  connectedCallback() {
    super.connectedCallback();

    // Observe changes to map size and invalidate to prevent broken rendering
    // Uses ResizeObserver in Chrome, otherwise window resize event
    if (typeof ResizeObserver === "function") {
      this._resizeObserver = new ResizeObserver(() =>
        this._debouncedResizeListener()
      );
      this._resizeObserver.observe(this.$.map);
    } else {
      window.addEventListener("resize", this._debouncedResizeListener);
    }

    this._map = setupLeafletMap(this.$.map);
    this._drawEntities(this.hass);
    let now = new Date();
    let startTime = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    
    this._configEntities.forEach((entity) => {
        const entityId = entity.entity;
        this.hass.callApi('GET', `history/period/${startTime}?filter_entity_id=${entityId}`).then((data) => {
            data = data[0];
            if (!data) return;
            let latlngs = [];
            data.forEach((log) => {
                if (log.attributes.latitude && log.attributes.longitude) {
                    latlngs.push([log.attributes.latitude + latitude_offset, log.attributes.longitude + longitude_offset]);
                }
            });
            let antPolyline = new L.Polyline.AntPath(latlngs);
            antPolyline.addTo(this._map);
        })
    });
    
    setTimeout(() => {
      this._resetMap();
      this._fitMap();
    }, 1);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    if (this._map) {
      this._map.remove();
    }

    if (this._resizeObserver) {
      this._resizeObserver.unobserve(this.$.map);
    } else {
      window.removeEventListener("resize", this._debouncedResizeListener);
    }
  }

  _resetMap() {
    if (!this._map) {
      return;
    }
    this._map.invalidateSize();
  }

  _fitMap() {
    const zoom = this._config.default_zoom;
    if (this._mapItems.length === 0) {
      this._map.setView(
        new window.L.LatLng(
          this.hass.config.latitude,
          this.hass.config.longitude
        ),
        zoom || 10
      );
      return;
    }

    const bounds = new window.L.latLngBounds(
      this._mapItems.map((item) => item.getLatLng())
    );
    this._map.fitBounds(bounds.pad(0.5));

    if (zoom && this._map.getZoom() > zoom) {
      this._map.setZoom(zoom);
    }
  }

  _drawEntities(hass) {
    const map = this._map;
    if (!map) {
      return;
    }

    if (this._mapItems) {
      this._mapItems.forEach((marker) => marker.remove());
    }
    const mapItems = (this._mapItems = []);

    this._configEntities.forEach((entity) => {
      const entityId = entity.entity;
      if (!(entityId in hass.states)) {
        return;
      }
      const stateObj = hass.states[entityId];
      const title = computeStateName(stateObj);
      let {
        latitude,
        longitude,
        passive,
        icon,
        radius,
        entity_picture: entityPicture,
        gps_accuracy: gpsAccuracy,
      } = stateObj.attributes;

      if (!(latitude && longitude)) {
        return;
      }
      latitude += latitude_offset;
      longitude += longitude_offset;

      let markerIcon;
      let iconHTML;
      let el;

      if (computeStateDomain(stateObj) === "zone") {
        // DRAW ZONE
        if (passive) return;

        // create icon
        if (icon) {
          el = document.createElement("ha-icon");
          el.setAttribute("icon", icon);
          iconHTML = el.outerHTML;
        } else {
          iconHTML = title;
        }

        markerIcon = window.L.divIcon({
          html: iconHTML,
          iconSize: [24, 24],
          className: "",
        });

        // create market with the icon
        mapItems.push(
          window.L.marker([latitude, longitude], {
            icon: markerIcon,
            interactive: false,
            title: title,
          }).addTo(map)
        );

        // create circle around it
        mapItems.push(
          window.L.circle([latitude, longitude], {
            interactive: false,
            color: "#FF9800",
            radius: radius,
          }).addTo(map)
        );

        return;
      }

      // DRAW ENTITY
      // create icon
      const entityName = title
        .split(" ")
        .map((part) => part[0])
        .join("")
        .substr(0, 3);

      el = document.createElement("ha-entity-marker");
      el.setAttribute("entity-id", entityId);
      el.setAttribute("entity-name", entityName);
      el.setAttribute("entity-picture", entityPicture || "");

      /* Leaflet clones this element before adding it to the map. This messes up
         our Polymer object and we can't pass data through. Thus we hack like this. */
      markerIcon = window.L.divIcon({
        html: el.outerHTML,
        iconSize: [48, 48],
        className: "",
      });

      // create market with the icon
      mapItems.push(
        window.L.marker([latitude, longitude], {
          icon: markerIcon,
          title: computeStateName(stateObj),
        }).addTo(map)
      );

      // create circle around if entity has accuracy
      if (gpsAccuracy) {
        mapItems.push(
          window.L.circle([latitude, longitude], {
            interactive: false,
            color: "#0288D1",
            radius: gpsAccuracy,
          }).addTo(map)
        );
      }
    });
  }
}

customElements.define("cn-map-card", CNMapCard);
