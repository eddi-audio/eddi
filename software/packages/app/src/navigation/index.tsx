import React, { useEffect } from 'react'
import { Linking } from 'react-native'
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import HomeScreen from '../screens/HomeScreen'
import CardScreen from '../screens/CardScreen'
import WriteScreen from '../screens/WriteScreen'

export type RootStackParamList = {
  Home: undefined
  Card: { id: string }
  Write: { cloneId?: string; sharedUrl?: string }
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export const navigationRef = createNavigationContainerRef<RootStackParamList>()

/**
 * A link shared into Eddi (Spotify/Tidal/YouTube → share sheet) arrives via
 * Linking, courtesy of MainActivity rewriting the ACTION_SEND into ACTION_VIEW.
 * Route it straight into the Write flow, which auto-resolves it.
 */
function openSharedUrl(url: string | null) {
  if (url && navigationRef.isReady()) {
    navigationRef.navigate('Write', { sharedUrl: url })
  }
}

export default function Navigation() {
  useEffect(() => {
    const sub = Linking.addEventListener('url', ({ url }) => openSharedUrl(url))
    return () => sub.remove()
  }, [])

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => { Linking.getInitialURL().then(openSharedUrl) }}
    >
      <Stack.Navigator
        id={undefined}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: '#0a0a0a' },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Card" component={CardScreen} />
        <Stack.Screen name="Write" component={WriteScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  )
}
