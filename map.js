import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

const slider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');
const tooltip = document.createElement('div');
tooltip.className = 'map-tooltip';
document.getElementById('map').appendChild(tooltip);

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json',
  center: [-71.1, 42.355],
  zoom: 11,
  minZoom: 10,
  maxZoom: 17,
});

let stations = [];
let timeFilter = Number(slider.value);
let arrivalsByMinute;
let departuresByMinute;
let allArrivals;
let allDepartures;
let radiusScale;

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

  updateTrafficCounts();
}

function createStationProfiles(rawStations) {
  return rawStations
    .filter((station) => station.lat && station.lon)
    .map((station, index) => ({
      station_id: station.station_id ?? station.id ?? index,
      short_name: station.short_name,
      name: station.name || `Station ${index + 1}`,
      lat: Number(station.lat),
      lon: Number(station.lon),
      arrivals: 0,
      departures: 0,
      totalTraffic: 0,
    }));
}

function countWithinHour(buckets, stationId, minute) {
  let count = 0;
  for (let offset = -60; offset <= 60; offset += 1) {
    const bucket = (minute + offset + 1440) % 1440;
    count += buckets[bucket].get(stationId) ?? 0;
  }
  return count;
}

function updateTrafficCounts() {
  if (!stations.length || !arrivalsByMinute || !departuresByMinute) return;

  stations = stations.map((station) => {
    const arrivals = timeFilter === -1
      ? allArrivals.get(station.short_name) ?? 0
      : countWithinHour(arrivalsByMinute, station.short_name, timeFilter);
    const departures = timeFilter === -1
      ? allDepartures.get(station.short_name) ?? 0
      : countWithinHour(departuresByMinute, station.short_name, timeFilter);

    return {
      ...station,
      arrivals,
      departures,
      totalTraffic: arrivals + departures,
    };
  });

  renderStations();
}

function flowColor(flowRatio) {
  if (flowRatio >= 0.6) return '#4281ab';
  if (flowRatio <= 0.4) return '#ff8500';
  return '#bd70a9';
}

function renderStations() {
  if (!stations.length) return;

  const svg = d3.select('#map').select('svg');
  const layer = svg.selectAll('g.station-layer').data([null]).join('g').attr('class', 'station-layer');

  const mappedStations = stations.map((station) => {
    const { arrivals, departures, totalTraffic: total } = station;
    const flowRatio = departures / Math.max(total, 1);
    const point = map.project(new maplibregl.LngLat(station.lon, station.lat));

    return {
      ...station,
      point,
      total,
      flowRatio,
      radius: radiusScale(total),
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
        .attr('fill-opacity', 0.62)
        .on('mouseenter', (event, d) => {
          const timeLabel = timeFilter === -1 ? 'Any time' : formatTime(timeFilter);
          tooltip.innerHTML = `<strong>${d.name}</strong><br/>${d.total} trips (${d.departures} departures, ${d.arrivals} arrivals)<br/>${timeLabel}`;
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
    .attr('fill-opacity', 0.62);
}

async function loadData() {
  try {
    const [bostonResponse, cambridgeResponse, bikeResponse, trips] = await Promise.all([
      fetch('https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson'),
      fetch('https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'),
      fetch('https://gbfs.bluebikes.com/gbfs/en/station_information.json'),
      d3.csv(
        'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv',
        (trip) => ({
          startedAt: new Date(trip.started_at),
          endedAt: new Date(trip.ended_at),
          startStationId: trip.start_station_id,
          endStationId: trip.end_station_id,
        }),
      ),
    ]);

    for (const response of [bostonResponse, cambridgeResponse, bikeResponse]) {
      if (!response.ok) {
        throw new Error(`Data request failed (${response.status} ${response.statusText})`);
      }
    }

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

    if (!Array.isArray(stationInfo.data?.stations)) {
      throw new Error('Bike station data has an unexpected format.');
    }

    stations = createStationProfiles(stationInfo.data.stations);
    arrivalsByMinute = Array.from({ length: 1440 }, () => new Map());
    departuresByMinute = Array.from({ length: 1440 }, () => new Map());
    allArrivals = new Map();
    allDepartures = new Map();

    const addTrip = (counts, stationId, minute, byMinute) => {
      if (!stationId || !Number.isInteger(minute) || minute < 0 || minute >= 1440) return;
      const current = counts.get(stationId) ?? 0;
      counts.set(stationId, current + 1);
      const bucket = byMinute[minute];
      bucket.set(stationId, (bucket.get(stationId) ?? 0) + 1);
    };

    for (const trip of trips) {
      if (!Number.isFinite(trip.startedAt.getTime()) || !Number.isFinite(trip.endedAt.getTime())) continue;

      const startMinute = trip.startedAt.getHours() * 60 + trip.startedAt.getMinutes();
      const endMinute = trip.endedAt.getHours() * 60 + trip.endedAt.getMinutes();
      addTrip(allDepartures, trip.startStationId, startMinute, departuresByMinute);
      addTrip(allArrivals, trip.endStationId, endMinute, arrivalsByMinute);
    }

    const maxTraffic = d3.max(
      stations,
      (station) => (allArrivals.get(station.short_name) ?? 0) + (allDepartures.get(station.short_name) ?? 0),
    ) ?? 1;
    radiusScale = d3.scaleSqrt().domain([0, Math.max(maxTraffic, 1)]).range([0, 24]);

    d3.select('#map')
      .append('svg')
      .style('position', 'absolute')
      .style('inset', 0)
      .style('overflow', 'visible');

    map.on('move', renderStations);
    map.on('zoom', renderStations);
    map.on('pitch', renderStations);
    map.on('rotate', renderStations);

    updateTrafficCounts();
  } catch (error) {
    console.error('Unable to load bike traffic data:', error);
    const status = document.createElement('p');
    status.className = 'map-status';
    status.setAttribute('role', 'alert');
    status.textContent = 'Bike lane, station, or ride data could not be loaded. Please refresh the page.';
    document.getElementById('map').appendChild(status);
  }
}

slider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();
map.on('error', (event) => {
  if (event.error) console.error('Map rendering error:', event.error);
});
map.on('load', loadData);
