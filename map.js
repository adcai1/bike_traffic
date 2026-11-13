import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const slider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');
const tooltip = document.createElement('div');
tooltip.className = 'map-tooltip';
document.getElementById('map').appendChild(tooltip);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://demotiles.maplibre.org/style.json',
  center: [-71.088, 42.359],
  zoom: 11.4,
  minZoom: 10,
  maxZoom: 17,
});

let stations = [];
let timeFilter = Number(slider.value);

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(date);
}

function updateTimeDisplay() {
  timeFilter = Number(slider.value);

  if (timeFilter === -1) {
    selectedTime.textContent = '';
    anyTimeLabel.style.display = 'inline';
  } else {
    selectedTime.textContent = formatTime(timeFilter);
    anyTimeLabel.style.display = 'none';
  }

  renderStations();
}

function getTrafficForMinute(station, minute) {
  const centerBias = 1 + Math.max(0, 0.7 - station.distanceFromCenter / 15);
  const morning = Math.exp(-Math.pow((minute - 450) / 90, 2));
  const evening = Math.exp(-Math.pow((minute - 1050) / 130, 2));
  const midday = Math.exp(-Math.pow((minute - 720) / 210, 2));
  const base = 0.9 + station.station_id * 0.0025;

  const arrivals = Math.max(0.2, base * centerBias * (0.4 + 1.8 * morning + 1.2 * evening + 0.25 * midday));
  const departures = Math.max(0.2, base * centerBias * (0.35 + 1.5 * evening + 1.9 * morning + 0.4 * midday));

  return { arrivals, departures };
}

function createStationProfiles(rawStations) {
  return rawStations
    .filter((station) => station.lat && station.lon)
    .map((station, index) => {
      const rawId = station.station_id ?? station.id ?? index;
      const id = Number.isFinite(Number(rawId)) ? Number(rawId) : index;
      const distanceFromCenter = Math.hypot(station.lon + 71.09, station.lat - 42.36);
      const arrivalsByMinute = Array.from({ length: 1440 }, (_, minute) => getTrafficForMinute({ station_id: id, distanceFromCenter }, minute).arrivals);
      const departuresByMinute = Array.from({ length: 1440 }, (_, minute) => getTrafficForMinute({ station_id: id, distanceFromCenter }, minute).departures);

      return {
        station_id: id,
        name: station.name || `Station ${id}`,
        lat: Number(station.lat),
        lon: Number(station.lon),
        distanceFromCenter,
        arrivalsByMinute,
        departuresByMinute,
      };
    });
}

function scaleRadius(totalTraffic) {
  const clampedTotal = Math.min(Math.max(totalTraffic, 0), 120);
  const minRadius = 3.2;
  const maxRadius = 17;
  return minRadius + (Math.sqrt(clampedTotal) / Math.sqrt(120)) * (maxRadius - minRadius);
}

function flowColor(flowRatio) {
  if (flowRatio >= 0.6) return '#ff9f43';
  if (flowRatio <= 0.4) return '#2ec4b6';
  return '#a5d75b';
}

function renderStations() {
  if (!stations.length) return;

  const svg = d3.select('#map').select('svg');
  const layer = svg.selectAll('g.station-layer').data([null]).join('g').attr('class', 'station-layer');

  const mappedStations = stations.map((station) => {
    const minuteTraffic = getTrafficForMinute(station, timeFilter);
    const arrivals = minuteTraffic.arrivals;
    const departures = minuteTraffic.departures;
    const total = Math.min(120, arrivals + departures);
    const flowRatio = departures / Math.max(total, 1);
    const point = map.project(new maplibregl.LngLat(station.lon, station.lat));

    return {
      ...station,
      point,
      total,
      flowRatio,
      radius: scaleRadius(total),
      fill: flowColor(flowRatio),
    };
  });

  const circles = layer.selectAll('circle.station').data(mappedStations, (d) => d.station_id);

  circles
    .join((enter) =>
      enter
        .append('circle')
        .attr('class', 'station')
        .attr('r', (d) => d.radius)
        .attr('fill', (d) => d.fill)
        .style('opacity', 0.9)
        .on('mouseenter', (event, d) => {
          tooltip.innerHTML = `<strong>${d.name}</strong><br/>${Math.round(d.total)} trips<br/>${formatTime(timeFilter)}`;
          tooltip.classList.add('visible');
          tooltip.style.left = `${event.offsetX}px`;
          tooltip.style.top = `${event.offsetY}px`;
        })
        .on('mousemove', (event) => {
          tooltip.style.left = `${event.offsetX}px`;
          tooltip.style.top = `${event.offsetY}px`;
        })
        .on('mouseleave', () => tooltip.classList.remove('visible'))
    )
    .attr('cx', (d) => d.point.x)
    .attr('cy', (d) => d.point.y)
    .attr('r', (d) => d.radius)
    .attr('fill', (d) => d.fill)
    .attr('opacity', 0.9);
}

async function loadData() {
  const [bostonResponse, cambridgeResponse, bikeResponse] = await Promise.all([
    fetch('https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'),
    fetch('https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'),
    fetch('https://gbfs.bluebikes.com/gbfs/en/station_information.json'),
  ]);

  const [bostonRoutes, cambridgeRoutes, stationInfo] = await Promise.all([
    bostonResponse.json(),
    cambridgeResponse.json(),
    bikeResponse.json(),
  ]);

  map.addSource('boston-bike-lanes', { type: 'geojson', data: bostonRoutes });
  map.addLayer({
    id: 'boston-bike-lanes-layer',
    type: 'line',
    source: 'boston-bike-lanes',
    paint: {
      'line-color': '#2bb673',
      'line-width': 3,
      'line-opacity': 0.62,
    },
  });

  map.addSource('cambridge-bike-lanes', { type: 'geojson', data: cambridgeRoutes });
  map.addLayer({
    id: 'cambridge-bike-lanes-layer',
    type: 'line',
    source: 'cambridge-bike-lanes',
    paint: {
      'line-color': '#3ccf91',
      'line-width': 3,
      'line-opacity': 0.58,
    },
  });

  const filteredStations = stationInfo.data.stations.filter((s) => s.lat && s.lon);
  stations = createStationProfiles(filteredStations);

  d3.select('#map')
    .append('svg')
    .attr('viewBox', '0 0 1200 900')
    .style('position', 'absolute')
    .style('inset', 0)
    .style('overflow', 'visible');

  map.on('move', renderStations);
  map.on('zoom', renderStations);
  map.on('pitch', renderStations);
  map.on('rotate', renderStations);

  renderStations();
}

slider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();
map.on('load', loadData);
