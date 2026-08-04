import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { SharingReportReason } from '../../api/sharingSafety';
import type { AppColors } from '../theme/ThemeContext';

const REASONS: Array<{
  value: SharingReportReason;
  label: string;
  description: string;
}> = [
  { value: 'UNWANTED_SHARING', label: '원치 않는 공유', description: '동의하지 않은 일정이나 캘린더 공유' },
  { value: 'HARASSMENT', label: '괴롭힘', description: '반복적인 초대나 불쾌한 접촉' },
  { value: 'SPAM', label: '스팸', description: '무관하거나 반복적인 홍보성 공유' },
  { value: 'INAPPROPRIATE_CONTENT', label: '부적절한 내용', description: '위협적이거나 부적절한 일정 내용' },
  { value: 'PRIVACY_CONCERN', label: '개인정보 우려', description: '위치·시간 등 사생활 정보 노출' },
  { value: 'OTHER', label: '기타', description: '위 사유에 포함되지 않는 문제' },
];

export default function SharingReportModal({
  visible,
  owner,
  colors,
  accent,
  pending,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  owner: string;
  colors: AppColors;
  accent: string;
  pending: boolean;
  onClose: () => void;
  onSubmit: (reason: SharingReportReason, details: string) => Promise<void>;
}) {
  const [reason, setReason] = useState<SharingReportReason>('UNWANTED_SHARING');
  const [details, setDetails] = useState('');

  useEffect(() => {
    if (!visible) return;
    setReason('UNWANTED_SHARING');
    setDetails('');
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={pending ? undefined : onClose}
      statusBarTranslucent
    >
      <View style={styles.root} accessibilityViewIsModal>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="신고 창 닫기"
          disabled={pending}
          onPress={onClose}
          style={styles.backdrop}
        />
        <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />
          <View style={styles.heading}>
            <View style={styles.headingCopy}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>공유 신고</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]} numberOfLines={2}>
                {owner} 사용자의 공유를 운영팀에 전달합니다.
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="신고 취소"
              disabled={pending}
              onPress={onClose}
              style={[styles.close, { backgroundColor: colors.surface2 }]}
            >
              <Ionicons name="close" size={21} color={colors.textPrimary} />
            </Pressable>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>신고 사유</Text>
            <View style={[styles.reasonList, { borderColor: colors.border }]}>
              {REASONS.map((option, index) => {
                const selected = reason === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => setReason(option.value)}
                    style={[
                      styles.reasonRow,
                      index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
                    ]}
                  >
                    <View style={styles.reasonCopy}>
                      <Text style={[styles.reasonTitle, { color: colors.textPrimary }]}>{option.label}</Text>
                      <Text style={[styles.reasonDescription, { color: colors.textSecondary }]}>{option.description}</Text>
                    </View>
                    <View style={[styles.radio, { borderColor: selected ? accent : colors.border, backgroundColor: selected ? accent : 'transparent' }]}>
                      {selected ? <Ionicons name="checkmark" size={13} color="#fff" /> : null}
                    </View>
                  </Pressable>
                );
              })}
            </View>
            <Text style={[styles.sectionLabel, { color: colors.textPrimary }]}>추가 설명 (선택)</Text>
            <TextInput
              value={details}
              onChangeText={value => setDetails(value.slice(0, 500))}
              placeholder="운영팀이 확인할 내용을 적어 주세요."
              placeholderTextColor={colors.inputPlaceholder}
              multiline
              maxLength={500}
              textAlignVertical="top"
              style={[
                styles.details,
                {
                  color: colors.textPrimary,
                  backgroundColor: colors.inputBackground,
                  borderColor: colors.inputBorder,
                },
              ]}
            />
            <Text style={[styles.counter, { color: colors.textSecondary }]}>{details.length}/500</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: pending, disabled: pending }}
              disabled={pending}
              onPress={() => onSubmit(reason, details)}
              style={({ pressed }) => [styles.submit, { backgroundColor: accent, opacity: pending || pressed ? 0.65 : 1 }]}
            >
              {pending ? <ActivityIndicator color="#fff" /> : <Ionicons name="flag-outline" size={18} color="#fff" />}
              <Text style={styles.submitText}>{pending ? '접수 중…' : '신고 접수'}</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.46)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingTop: 9 },
  handle: { width: 38, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 13 },
  heading: { paddingHorizontal: 20, flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  headingCopy: { flex: 1 },
  title: { fontSize: 22, lineHeight: 29, fontWeight: '900' },
  subtitle: { marginTop: 4, fontSize: 13, lineHeight: 19, fontWeight: '600' },
  close: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 20, paddingTop: 22, paddingBottom: 30 },
  sectionLabel: { marginBottom: 9, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  reasonList: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 15, overflow: 'hidden', marginBottom: 22 },
  reasonRow: { minHeight: 66, paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  reasonCopy: { flex: 1 },
  reasonTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  reasonDescription: { marginTop: 2, fontSize: 11, lineHeight: 16, fontWeight: '600' },
  radio: { width: 22, height: 22, borderWidth: 1.5, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  details: { minHeight: 104, borderWidth: 1, borderRadius: 13, paddingHorizontal: 13, paddingVertical: 12, fontSize: 14, lineHeight: 20 },
  counter: { marginTop: 6, textAlign: 'right', fontSize: 11, fontWeight: '600' },
  submit: { minHeight: 50, marginTop: 16, borderRadius: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  submitText: { color: '#fff', fontSize: 15, lineHeight: 20, fontWeight: '800' },
});
