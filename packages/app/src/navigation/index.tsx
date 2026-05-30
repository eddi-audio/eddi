import React from 'react'
import { NavigationContainer } from '@react-navigation/native'
import { createNativeStackNavigator } from '@react-navigation/native-stack'
import HomeScreen from '../screens/HomeScreen'
import CardScreen from '../screens/CardScreen'
import WriteScreen from '../screens/WriteScreen'

export type RootStackParamList = {
  Home: undefined
  Card: { id: string }
  Write: { cloneId?: string }
}

const Stack = createNativeStackNavigator<RootStackParamList>()

export default function Navigation() {
  return (
    <NavigationContainer>
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
