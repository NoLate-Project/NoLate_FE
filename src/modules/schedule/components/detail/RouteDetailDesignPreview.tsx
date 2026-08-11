import styles from './RouteDetailDesignPreview.styles';
import React, { useMemo, useState } from 'react';
import { useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '../../../theme/ThemeContext';
import {
  CurrentCompact,
  CurrentExpanded,
  ImprovedCompact,
  ImprovedExpanded,
  SheetHandle,
} from './RouteDetailPreviewContent';
import { buildPalette } from './routeDetailPreviewPalette';
import { MapControls, PreviewHeader, RouteMap } from './RouteDetailPreviewMap';
import type {
  RouteDetailDesignPreviewProps as Props,
  RouteDetailPreviewSheetMode,
} from './RouteDetailDesignPreview.types';

export type {
  RouteDetailDesignVariant,
  RouteDetailPreviewSheetMode,
} from './RouteDetailDesignPreview.types';

export default function RouteDetailDesignPreview({
  variant,
  initialSheetMode = 'expanded',
  routeDetailInfo,
  routeProgressSegments,
}: Props) {
  const { mode } = useTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const isDark = mode === 'dark';
  const palette = useMemo(() => buildPalette(isDark), [isDark]);
  const [sheetMode, setSheetMode] =
    useState<RouteDetailPreviewSheetMode>(initialSheetMode);
  const [departed, setDeparted] = useState(false);
  const [selectedLeg, setSelectedLeg] = useState<string | null>(null);
  const [selectedRouteStepId, setSelectedRouteStepId] = useState<string>();
  const [infoExpanded, setInfoExpanded] = useState(false);
  const expanded = sheetMode === 'expanded';
  const sheetHeight = expanded
    ? Math.min(
        variant === 'improved' ? 558 : 574,
        Math.round(height * (variant === 'improved' ? 0.64 : 0.66)),
      )
    : variant === 'improved'
    ? 224 + insets.bottom
    : 178 + insets.bottom;

  return (
    <View style={[styles.root, { backgroundColor: palette.background }]}>
      <RouteMap palette={palette} selectedLeg={selectedLeg} />
      <PreviewHeader
        variant={variant}
        palette={palette}
        topInset={insets.top}
      />
      <MapControls
        variant={variant}
        palette={palette}
        sheetHeight={sheetHeight}
        onShowAll={() => {
          setSelectedLeg(null);
          setSelectedRouteStepId(undefined);
        }}
      />

      <View
        style={[
          styles.sheet,
          {
            height: sheetHeight,
            paddingBottom: insets.bottom,
            backgroundColor:
              variant === 'current' ? palette.background : palette.sheet,
            borderColor: palette.border,
          },
        ]}
      >
        <SheetHandle
          expanded={expanded}
          palette={palette}
          onPress={() => setSheetMode(expanded ? 'compact' : 'expanded')}
        />
        {variant === 'current' ? (
          expanded ? (
            <CurrentExpanded
              palette={palette}
              departed={departed}
              onDeparture={() => setDeparted(value => !value)}
            />
          ) : (
            <CurrentCompact palette={palette} />
          )
        ) : expanded ? (
          <ImprovedExpanded
            palette={palette}
            isDark={isDark}
            routeDetailInfo={routeDetailInfo}
            routeProgressSegments={routeProgressSegments}
            departed={departed}
            selectedRouteStepId={selectedRouteStepId}
            infoExpanded={infoExpanded}
            onDeparture={() => setDeparted(value => !value)}
            onSelectRouteStep={step => {
              const nextSelectedStepId =
                selectedRouteStepId === step.id ? undefined : step.id;
              setSelectedRouteStepId(nextSelectedStepId);
              setSelectedLeg(
                nextSelectedStepId
                  ? step.type === 'SUBWAY' || step.type === 'BUS'
                    ? step.badgeText ?? step.lineName ?? null
                    : step.type === 'WALK'
                    ? '도보'
                    : null
                  : null,
              );
            }}
            onToggleInfo={() => setInfoExpanded(value => !value)}
          />
        ) : (
          <ImprovedCompact
            palette={palette}
            departed={departed}
            onDeparture={() => setDeparted(value => !value)}
          />
        )}
      </View>
    </View>
  );
}
