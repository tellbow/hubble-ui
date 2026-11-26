// S I Z E S

// this sizes map uses for both js calculations and css styles
// all sizes in this map should be considered in pixels
export const sizes = {
  endpointWidth: 560,
  endpointShadowSize: 24,
  endpointIconWidth: 80,
  endpointHeaderheight: 115,
  endpointTitleHeight: 29,
  endpointSubtitleHeight: 12,
  endpointHPadding: 200,
  endpointVPadding: 200,
  endpointFunctionHeight: 16,
  distanceBetweenConnectors: 50,
  connectorCardStartGap: 40,
  connectorCardEndGap: 120,
  minArrowLength: 50,
  arrowStartTopOffset: 50,
  arrowHandleWidth: 20,
  arrowRadius: 5,
  arrowOverlapGap: 20,
  aroundCardPadX: 40,
  aroundCardPadY: 40,
  endpointProtocolHeight: 16,
  egressConnectorWidth: 38,
  ingressConnectorPadding: 24,
  linkWidth: 2,
  linkCurveRadius: 8,
  connectorWidth: 4,
  flowsTableRowHeight: 20,
  flowsTableHeadHeight: 24,
  feetOuterWidth: 4,
  feetInnerWidth: 2,
  feetInnerWidthThick: 6,
  topBarHeight: 50,
  arrowHandleHWRatio: 10.87 / 11.61,
  namespaceBackplatePadding: 200,
};

// C O L O R S
export const colors = {
  // Neutral colors follow the theme; d3 must set them with .style(), as SVG
  // attributes take no var().
  arrowStroke: 'var(--hubble-ui-svcmap-arrow-stroke)',
  arrowStrokeGreen: '#7ED268',
  arrowStrokeRed: '#C50000',
  arrowHandle: '#58626D',
  startPlateStroke: 'var(--hubble-ui-svcmap-start-plate)',
  startPlateFill: 'var(--hubble-ui-svcmap-start-plate)',
  connectorFill: 'var(--hubble-ui-svcmap-connector-fill)',
  connectorStroke: 'var(--hubble-ui-svcmap-connector-stroke)',
  connectorFillGreen: '#7ED268',
  connectorStrokeGreen: '#7ED268',
  connectorStrokeRed: '#C50000',
  connectorFillRed: '#C50000',
  feetOuterStroke: '#EBEEF0',
  feetNeutralStroke: 'var(--hubble-ui-svcmap-feet-neutral)',
  feetRedStroke: '#C50000',
  padlockGreen: '#2F9316',
};

export const zIndex = {};
