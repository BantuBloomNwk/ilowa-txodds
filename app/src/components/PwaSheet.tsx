/**
 * Shared bottom-sheet Modal wrapper.
 *
 * React Native Web's Modal portals its content to the document root, outside the app's
 * centered PWA frame, so a sheet styled with `left:0, right:0` spans the full browser
 * viewport on desktop instead of the app's narrow column. Invisible on mobile, because
 * there the viewport already matches the frame width. Every bottom sheet should render
 * through this wrapper instead of hand-rolling Modal, backdrop, and absolute-positioned
 * sheet styling, so the width constraint can't be forgotten again.
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, View, StyleSheet, type ViewStyle, type StyleProp } from 'react-native';
import { PWA_MAX_WIDTH } from '../lib/viewport-clamp';

export function PwaSheet({
  visible = true,
  onClose,
  children,
  sheetStyle,
  backdropColor = 'rgba(4,5,8,0.72)',
  animationType = 'slide',
}: {
  visible?: boolean;
  onClose: () => void;
  children: ReactNode;
  sheetStyle?: StyleProp<ViewStyle>;
  backdropColor?: string;
  animationType?: 'slide' | 'none' | 'fade';
}) {
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: backdropColor }]} onPress={onClose} />
        <View style={s.frame} pointerEvents="box-none">
          <View style={sheetStyle}>{children}</View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end', alignItems: 'center' },
  // Constrain to the app's mobile frame so the sheet doesn't span the full browser
  // width on desktop PWA (the Modal renders at the viewport root, outside the frame).
  frame: { width: '100%', maxWidth: PWA_MAX_WIDTH, alignSelf: 'center' },
});
