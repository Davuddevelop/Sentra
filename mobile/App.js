import { useEffect, useState } from 'react'
import { View, ActivityIndicator, StyleSheet } from 'react-native'
import { StatusBar } from 'expo-status-bar'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { getToken, verifyToken } from './src/services/api'
import { registerBackgroundFlush } from './src/services/backgroundTask'
import PairingScreen from './src/screens/PairingScreen'
import SetupScreen   from './src/screens/SetupScreen'
import StatusScreen  from './src/screens/StatusScreen'
import { T } from './src/theme'

export default function App() {
  const [state, setState] = useState('loading') // loading | unpaired | setup | paired
  const [info,  setInfo]  = useState(null)       // { token, deviceName, childName }

  useEffect(() => {
    registerBackgroundFlush()
    ;(async () => {
      const token = await getToken()
      if (!token) { setState('unpaired'); return }

      try {
        const data = await verifyToken(token)
        setInfo({ token, deviceName: data.device_name, childName: data.child_name })
        // Show setup screen only once — after first successful pairing
        const setupDone = await AsyncStorage.getItem('setupDone').catch(() => null)
        setState(setupDone ? 'paired' : 'setup')
      } catch {
        setState('unpaired')
      }
    })()
  }, [])

  if (state === 'loading') {
    return (
      <View style={s.splash}>
        <ActivityIndicator color={T.cream} size="large" />
      </View>
    )
  }

  if (state === 'setup') {
    return (
      <>
        <StatusBar style="dark" />
        <SetupScreen onComplete={async () => {
          await AsyncStorage.setItem('setupDone', '1')
          setState('paired')
        }} />
      </>
    )
  }

  if (state === 'paired' && info) {
    return (
      <>
        <StatusBar style="dark" />
        <StatusScreen
          deviceName={info.deviceName}
          childName={info.childName}
          onDisconnect={() => { setInfo(null); setState('unpaired') }}
        />
      </>
    )
  }

  return (
    <>
      <StatusBar style="dark" />
      <PairingScreen onPaired={(i) => { setInfo(i); setState('setup') }} />
    </>
  )
}

const s = StyleSheet.create({
  splash: { flex: 1, backgroundColor: T.mossDeep, alignItems: 'center', justifyContent: 'center' },
})
