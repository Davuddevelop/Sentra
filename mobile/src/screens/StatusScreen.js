import React, { useEffect, useState } from 'react'
import {
  View, Text, ScrollView, StyleSheet, Platform,
  TouchableOpacity, Alert,
} from 'react-native'
import { T } from '../theme'
import { clearToken, flushSignals } from '../services/api'
import { startMonitor, stopMonitor } from '../services/monitor'
import { registerPushToken } from '../services/notifications'

const MONITORED_APPS = [
  { name: 'ChatGPT',      color: T.moss },
  { name: 'Character.AI', color: '#7C3AED' },
  { name: 'Replika',      color: '#0EA5E9' },
  { name: 'Claude',       color: T.terra },
  { name: 'Gemini',       color: '#1D4ED8' },
  { name: 'Copilot',      color: '#059669' },
]

export default function StatusScreen({ deviceName, childName, onDisconnect }) {
  const [uptime, setUptime]   = useState(0) // minutes
  const [flushed, setFlushed] = useState(0)
  const [platform] = useState(Platform.OS === 'ios' ? 'ios' : 'android')

  useEffect(() => {
    registerPushToken()
    startMonitor(platform)

    // Uptime counter
    const tick = setInterval(() => setUptime(m => m + 1), 60_000)

    // Flush every 60s and count
    const flush = setInterval(async () => {
      await flushSignals()
      setFlushed(n => n + 1)
    }, 60_000)

    return () => {
      clearInterval(tick)
      clearInterval(flush)
      stopMonitor()
    }
  }, [platform])

  function handleDisconnect() {
    Alert.alert(
      'Disconnect device',
      'This will stop monitoring. Your parent will be notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            stopMonitor()
            await clearToken()
            onDisconnect()
          },
        },
      ]
    )
  }

  return (
    <ScrollView style={s.root} contentContainerStyle={s.content}>

      {/* Header */}
      <View style={s.header}>
        <View style={s.logoRow}>
          <View style={s.logoMark} />
          <Text style={s.logoText}>Sentra</Text>
        </View>
        <View style={[s.badge, s.badgeOn]}>
          <View style={s.dot} />
          <Text style={s.badgeText}>Active</Text>
        </View>
      </View>

      {/* Identity */}
      <View style={s.identityCard}>
        <Text style={s.identityEyebrow}>Monitoring</Text>
        <Text style={s.identityName}>{childName}</Text>
        <Text style={s.identityDevice}>{deviceName} · {platform === 'ios' ? 'iPhone' : 'Android'}</Text>
      </View>

      {/* Stats row */}
      <View style={s.statsRow}>
        <View style={s.statCard}>
          <Text style={s.statNum}>{uptime}</Text>
          <Text style={s.statLabel}>Min{'\n'}active</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statNum}>{flushed}</Text>
          <Text style={s.statLabel}>Signal{'\n'}batches sent</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statNum}>{MONITORED_APPS.length}</Text>
          <Text style={s.statLabel}>Apps{'\n'}monitored</Text>
        </View>
      </View>

      {/* Monitored apps */}
      <Text style={s.sectionTitle}>What's being watched</Text>
      <View style={s.appGrid}>
        {MONITORED_APPS.map(app => (
          <View key={app.name} style={s.appPill}>
            <View style={[s.appDot, { backgroundColor: app.color }]} />
            <Text style={s.appName}>{app.name}</Text>
          </View>
        ))}
      </View>

      {/* What we DON'T collect */}
      <View style={s.privacyBox}>
        <Text style={s.privacyTitle}>Zero-Knowledge Promise</Text>
        {[
          'We never read message content',
          'No screenshots or screen recording',
          'No browsing history',
          'Pattern detection runs on-device only',
        ].map(item => (
          <View key={item} style={s.privacyRow}>
            <Text style={s.checkmark}>✓</Text>
            <Text style={s.privacyItem}>{item}</Text>
          </View>
        ))}
      </View>

      {/* Native capability status */}
      <Text style={s.sectionTitle}>Native permissions</Text>
      <View style={s.permBox}>
        {platform === 'ios' ? (
          <>
            <PermRow label="Family Controls (Screen Time)" status="requires-setup" />
            <PermRow label="Background App Refresh"        status="active" />
            <PermRow label="Notifications"                 status="active" />
          </>
        ) : (
          <>
            <PermRow label="Accessibility Service"   status="requires-setup" />
            <PermRow label="Device Administrator"    status="requires-setup" />
            <PermRow label="Background processing"   status="active" />
            <PermRow label="Notifications"           status="active" />
          </>
        )}
      </View>

      {/* Disconnect */}
      <TouchableOpacity style={s.disconnectBtn} onPress={handleDisconnect} activeOpacity={0.7}>
        <Text style={s.disconnectText}>Disconnect this device</Text>
      </TouchableOpacity>

    </ScrollView>
  )
}

function PermRow({ label, status }) {
  const isActive  = status === 'active'
  const needsSetup = status === 'requires-setup'
  return (
    <View style={sr.row}>
      <View style={[sr.dot, isActive ? sr.dotOn : sr.dotWarn]} />
      <Text style={sr.label}>{label}</Text>
      <Text style={[sr.status, isActive ? sr.statusOn : sr.statusWarn]}>
        {isActive ? 'Active' : 'Setup needed'}
      </Text>
    </View>
  )
}

const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: T.cream },
  content: { padding: 28, paddingTop: 56, paddingBottom: 48 },

  header:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 },
  logoRow:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoMark:  { width: 16, height: 20, backgroundColor: T.moss, borderRadius: 3 },
  logoText:  { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 20, color: T.ink, fontWeight: '500' },
  badge:     { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 6, borderRadius: 100 },
  badgeOn:   { backgroundColor: T.mossLight },
  dot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: T.moss },
  badgeText: { fontSize: 12, fontWeight: '600', color: T.moss },

  identityCard: { backgroundColor: T.mossDeep, borderRadius: 20, padding: 28, marginBottom: 20 },
  identityEyebrow: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 2, color: 'rgba(243,237,221,0.6)', marginBottom: 6 },
  identityName:   { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 34, color: T.cream, letterSpacing: -1, marginBottom: 4 },
  identityDevice: { fontSize: 13, color: 'rgba(243,237,221,0.6)' },

  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 28 },
  statCard: { flex: 1, backgroundColor: T.paper, borderRadius: 16, padding: 18, borderWidth: 0.5, borderColor: T.lineSoft },
  statNum:  { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 32, color: T.ink, letterSpacing: -1, marginBottom: 4 },
  statLabel:{ fontSize: 11, color: T.inkSoft, lineHeight: 15 },

  sectionTitle: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 2, color: T.inkSoft, marginBottom: 12 },

  appGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24 },
  appPill:  { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: T.paper, borderRadius: 100, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 0.5, borderColor: T.lineSoft },
  appDot:   { width: 7, height: 7, borderRadius: 4 },
  appName:  { fontSize: 13, color: T.ink, fontWeight: '500' },

  privacyBox:   { backgroundColor: T.mossLight, borderRadius: 16, padding: 20, marginBottom: 24 },
  privacyTitle: { fontSize: 13, fontWeight: '600', color: T.mossDeep, marginBottom: 12 },
  privacyRow:   { flexDirection: 'row', gap: 10, marginBottom: 8 },
  checkmark:    { color: T.moss, fontWeight: '700', fontSize: 14 },
  privacyItem:  { fontSize: 13, color: T.mossDeep, flex: 1 },

  permBox: { backgroundColor: T.paper, borderRadius: 16, overflow: 'hidden', borderWidth: 0.5, borderColor: T.lineSoft, marginBottom: 32 },

  disconnectBtn: { alignItems: 'center', padding: 16 },
  disconnectText: { fontSize: 14, color: T.terra, fontWeight: '500' },
})

const sr = StyleSheet.create({
  row:       { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderBottomWidth: 0.5, borderBottomColor: T.lineSoft },
  dot:       { width: 8, height: 8, borderRadius: 4 },
  dotOn:     { backgroundColor: T.moss },
  dotWarn:   { backgroundColor: '#D97706' },
  label:     { flex: 1, fontSize: 14, color: T.ink },
  status:    { fontSize: 12, fontWeight: '500' },
  statusOn:  { color: T.moss },
  statusWarn:{ color: '#D97706' },
})
