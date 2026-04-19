import React, { useState } from 'react'
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView,
  Platform, ScrollView, Linking,
} from 'react-native'
import { T } from '../theme'
import { saveToken, verifyToken } from '../services/api'

export default function PairingScreen({ onPaired }) {
  const [token,  setToken]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  async function handleConnect() {
    const t = token.trim()
    if (t.length < 8) { setError('Please enter a valid device token.'); return }

    setLoading(true); setError('')
    try {
      const data = await verifyToken(t)
      await saveToken(t)
      onPaired({ token: t, deviceName: data.device_name, childName: data.child_name })
    } catch (err) {
      setError(err.message || 'Could not connect. Check the token and try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <KeyboardAvoidingView style={s.root} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        {/* Logo */}
        <View style={s.logoRow}>
          <View style={s.logoMark} />
          <Text style={s.logoText}>Sentra</Text>
        </View>

        <Text style={s.title}>Connect this{'\n'}device.</Text>
        <Text style={s.sub}>Enter the device token from your parent's Sentra dashboard to begin monitoring.</Text>

        {/* Token input */}
        <View style={s.inputWrap}>
          <TextInput
            style={s.input}
            placeholder="Paste device token here"
            placeholderTextColor={T.inkSoft}
            value={token}
            onChangeText={t => { setToken(t); setError('') }}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleConnect}
          />
        </View>

        {error ? <Text style={s.error}>{error}</Text> : null}

        <TouchableOpacity style={s.btn} onPress={handleConnect} disabled={loading} activeOpacity={0.85}>
          {loading
            ? <ActivityIndicator color={T.creamSoft} />
            : <Text style={s.btnText}>Connect device</Text>
          }
        </TouchableOpacity>

        {/* Help strip */}
        <View style={s.helpBox}>
          <Text style={s.helpTitle}>Where do I find my token?</Text>
          <Text style={s.helpBody}>
            1. Open the Sentra dashboard on your parent's computer{'\n'}
            2. Go to your child's profile → Add device{'\n'}
            3. Copy the generated token and paste it above
          </Text>
        </View>

        <TouchableOpacity onPress={() => Linking.openURL('https://sentra.app/privacy')}>
          <Text style={s.privacy}>Privacy policy — we never read message content</Text>
        </TouchableOpacity>

      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const s = StyleSheet.create({
  root:      { flex: 1, backgroundColor: T.cream },
  scroll:    { padding: 32, paddingTop: 64, flexGrow: 1 },
  logoRow:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 40 },
  logoMark:  { width: 18, height: 22, backgroundColor: T.moss, borderRadius: 3 },
  logoText:  { fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', fontSize: 22, color: T.ink, fontWeight: '500' },
  title:     { fontSize: 40, fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif', color: T.ink, lineHeight: 44, letterSpacing: -1, marginBottom: 14 },
  sub:       { fontSize: 16, color: T.inkSoft, lineHeight: 24, marginBottom: 36 },
  inputWrap: { marginBottom: 12 },
  input: {
    backgroundColor: T.paper, borderRadius: 100, borderWidth: 1,
    borderColor: T.line, paddingHorizontal: 22, paddingVertical: 16,
    fontSize: 15, color: T.ink, fontFamily: 'monospace',
  },
  error:    { fontSize: 13, color: T.terra, marginBottom: 12, paddingHorizontal: 4 },
  btn: {
    backgroundColor: T.ink, borderRadius: 100,
    paddingVertical: 18, alignItems: 'center', marginBottom: 28,
  },
  btnText:  { color: T.creamSoft, fontSize: 16, fontWeight: '600' },
  helpBox: {
    backgroundColor: T.mossLight, borderRadius: 16,
    padding: 20, marginBottom: 24,
  },
  helpTitle: { fontSize: 13, fontWeight: '600', color: T.mossDeep, marginBottom: 8 },
  helpBody:  { fontSize: 13, color: T.mossDeep, lineHeight: 20 },
  privacy:   { fontSize: 12, color: T.moss, textAlign: 'center', textDecorationLine: 'underline' },
})
