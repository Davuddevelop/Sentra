import { useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Platform,
  TouchableOpacity, Linking, Alert,
} from 'react-native'
import { T } from '../theme'

const STEPS_ANDROID = [
  {
    title: 'Enable Accessibility Service',
    body:  'This lets Sentra detect when your child uses AI chatbots and scan for harmful patterns on-device.',
    action: 'Open Accessibility Settings',
    onPress: () => Linking.openSettings(),
    required: true,
    detail: 'Settings → Accessibility → Installed Services → Sentra → Enable',
  },
  {
    title: 'Activate Device Administrator',
    body:  'Prevents your child from uninstalling Sentra without the parent PIN.',
    action: 'Enable Device Admin',
    onPress: () => Linking.openSettings(),
    required: true,
    detail: 'Settings → Security → Device Admin Apps → Sentra → Activate',
  },
  {
    title: 'Allow Background Activity',
    body:  'Ensures Sentra keeps monitoring even when the screen is off.',
    action: 'Open Battery Settings',
    onPress: () => Linking.openSettings(),
    required: false,
    detail: 'Settings → Apps → Sentra → Battery → Unrestricted',
  },
]

const STEPS_IOS = [
  {
    title: 'Grant Family Controls Access',
    body:  'Uses Apple\'s official Screen Time API to monitor AI app usage. No content is read.',
    action: 'Enable Family Controls',
    onPress: () => Alert.alert('Family Controls', 'Tap "Allow" on the next system dialog to grant Sentra parental monitoring access.'),
    required: true,
    detail: 'A system dialog will appear — tap Allow to continue.',
  },
  {
    title: 'Allow Notifications',
    body:  'Sends instant alerts to your phone when Sentra detects a risk.',
    action: 'Enable Notifications',
    onPress: () => Linking.openSettings(),
    required: true,
    detail: 'Settings → Sentra → Notifications → Allow',
  },
  {
    title: 'Enable Background Refresh',
    body:  'Ensures signals are flushed to the Sentra dashboard even when the app is closed.',
    action: 'Open Sentra Settings',
    onPress: () => Linking.openSettings(),
    required: false,
    detail: 'Settings → General → Background App Refresh → Sentra → On',
  },
]

export default function SetupScreen({ onComplete }) {
  const steps = Platform.OS === 'ios' ? STEPS_IOS : STEPS_ANDROID
  const [done, setDone] = useState({})

  const requiredDone = steps.filter(s => s.required).every((_, i) => done[i])

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      <Text style={s.eyebrow}>Setup required</Text>
      <Text style={s.title}>Grant{'\n'}permissions.</Text>
      <Text style={s.sub}>
        {Platform.OS === 'ios'
          ? 'Sentra uses Apple\'s Family Controls API — no message content is ever read.'
          : 'Sentra uses Android Accessibility Services to detect AI app usage patterns on-device.'}
      </Text>

      {steps.map((step, i) => (
        <View key={i} style={[s.card, done[i] && s.cardDone]}>
          <View style={s.cardTop}>
            <View style={s.cardLeft}>
              <View style={[s.num, done[i] && s.numDone]}>
                <Text style={[s.numText, done[i] && s.numTextDone]}>{done[i] ? '✓' : i + 1}</Text>
              </View>
              <View style={s.cardText}>
                <View style={s.titleRow}>
                  <Text style={s.cardTitle}>{step.title}</Text>
                  {step.required
                    ? <Text style={s.reqBadge}>Required</Text>
                    : <Text style={s.optBadge}>Optional</Text>}
                </View>
                <Text style={s.cardBody}>{step.body}</Text>
                <Text style={s.cardDetail}>{step.detail}</Text>
              </View>
            </View>
          </View>

          <View style={s.cardActions}>
            <TouchableOpacity
              style={s.actionBtn}
              onPress={() => { step.onPress(); setDone(d => ({ ...d, [i]: true })) }}
              activeOpacity={0.8}
            >
              <Text style={s.actionBtnText}>{step.action}</Text>
            </TouchableOpacity>
            {!done[i] && (
              <TouchableOpacity onPress={() => setDone(d => ({ ...d, [i]: true }))} style={s.skipBtn}>
                <Text style={s.skipText}>Mark done</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ))}

      <TouchableOpacity
        style={[s.continueBtn, !requiredDone && s.continueBtnDisabled]}
        onPress={requiredDone ? onComplete : () => Alert.alert('Required steps', 'Please complete all required steps before continuing.')}
        activeOpacity={0.85}
      >
        <Text style={s.continueBtnText}>
          {requiredDone ? 'Continue to dashboard →' : `Complete ${steps.filter((s, i) => s.required && !done[i]).length} required step(s) to continue`}
        </Text>
      </TouchableOpacity>

    </ScrollView>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: T.cream },
  content: { padding: 28, paddingTop: 56, paddingBottom: 48 },
  eyebrow: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: T.moss, marginBottom: 8 },
  title:   { fontSize: 40, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: T.ink, letterSpacing: -1, lineHeight: 44, marginBottom: 12 },
  sub:     { fontSize: 15, color: T.inkSoft, lineHeight: 22, marginBottom: 28 },

  card:     { backgroundColor: T.paper, borderRadius: 20, padding: 22, marginBottom: 16, borderWidth: 0.5, borderColor: T.lineSoft },
  cardDone: { borderColor: T.moss, backgroundColor: '#F0F7F2' },
  cardTop:  { marginBottom: 16 },
  cardLeft: { flexDirection: 'row', gap: 16 },

  num:         { width: 32, height: 32, borderRadius: 16, backgroundColor: T.creamDeep, alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 },
  numDone:     { backgroundColor: T.moss },
  numText:     { fontSize: 14, fontWeight: '700', color: T.inkSoft },
  numTextDone: { color: T.cream },

  cardText:  { flex: 1 },
  titleRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: T.ink },
  cardBody:  { fontSize: 14, color: T.inkSoft, lineHeight: 20, marginBottom: 6 },
  cardDetail:{ fontSize: 12, color: T.moss, lineHeight: 18 },

  reqBadge: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: T.terra, backgroundColor: '#F5DBCC', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },
  optBadge: { fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8, color: T.inkSoft, backgroundColor: T.creamDeep, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 100 },

  cardActions:   { flexDirection: 'row', gap: 12, alignItems: 'center' },
  actionBtn:     { backgroundColor: T.ink, borderRadius: 100, paddingVertical: 10, paddingHorizontal: 18 },
  actionBtnText: { color: T.creamSoft, fontSize: 13, fontWeight: '600' },
  skipBtn:       { padding: 8 },
  skipText:      { fontSize: 13, color: T.moss, fontWeight: '500' },

  continueBtn:         { backgroundColor: T.moss, borderRadius: 100, paddingVertical: 18, alignItems: 'center', marginTop: 8 },
  continueBtnDisabled: { backgroundColor: T.inkSoft, opacity: 0.5 },
  continueBtnText:     { color: T.cream, fontSize: 15, fontWeight: '600' },
})
