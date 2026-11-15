import React from 'react';
import {Redirect} from 'expo-router';
import {Platform, ScrollView} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {JourneySubwayObservationTrial} from '../../src/modules/journey/JourneySubwayObservationTrial';

export default function SubwayObservationRoute() {
    if (!__DEV__ || Platform.OS !== 'ios') return <Redirect href="/schedule"/>;
    return <SubwayObservationScreen/>;
}
function SubwayObservationScreen() {
    const insets = useSafeAreaInsets();
    return <ScrollView style={{backgroundColor: 'white'}} contentContainerStyle={{padding: 20, paddingTop: insets.top + 20, paddingBottom: insets.bottom + 20}}>
        <JourneySubwayObservationTrial/>
    </ScrollView>;
}
