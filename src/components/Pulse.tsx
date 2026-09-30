import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

const SIZE = 180;
const RINGS = 3;

/** Radar-style rings that show the phone is visible / searching. */
export function Pulse({ color, glyph }: { color: string; glyph: string }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, {
        toValue: 1,
        duration: 2400,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);

  return (
    <View style={styles.container}>
      {Array.from({ length: RINGS }, (_, i) => {
        // Offset each ring so they chase each other outward.
        const phase = Animated.modulo(Animated.add(progress, i / RINGS), 1);
        return (
          <Animated.View
            key={i}
            style={[
              styles.ring,
              {
                borderColor: color,
                opacity: phase.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.6, 0],
                }),
                transform: [
                  {
                    scale: phase.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.35, 1],
                    }),
                  },
                ],
              },
            ]}
          />
        );
      })}
      <View style={[styles.core, { backgroundColor: color }]}>
        <Text style={styles.glyph}>{glyph}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: SIZE,
    height: SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    borderWidth: 2,
  },
  core: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { color: colors.text, fontSize: 32, fontWeight: '800' },
});
