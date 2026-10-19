import React from 'react';
import TestRenderer,{act,type ReactTestRenderer} from 'react-test-renderer';
import JourneyGuidanceScreen from '../src/modules/journey/JourneyGuidanceScreen';

let mockId:unknown='41',mockEnabled=true,mockAutomatic=true;
const mockManual=jest.fn(()=>{throw new Error('MANUAL_SESSION_MUST_NOT_MOUNT');});
const mockReplace=jest.fn();
jest.mock('@expo/vector-icons',()=>({Ionicons:'Ionicons'}));
jest.mock('../src/modules/theme/ThemeContext',()=>({useTheme:()=>({colors:{background:'#fff',textPrimary:'#111',textSecondary:'#666'}})}));
jest.mock('react-native-safe-area-context',()=>({useSafeAreaInsets:()=>({top:0,bottom:0})}));
jest.mock('expo-router',()=>({useLocalSearchParams:()=>({scheduleId:mockId}),Redirect:'Redirect',
    useRouter:()=>({canGoBack:()=>false,replace:mockReplace})}));
jest.mock('../src/modules/journey/journeyFeature',()=>({isJourneyGuidanceEnabled:()=>mockEnabled,isAutomaticJourneyEntryEnabled:()=>mockAutomatic}));
jest.mock('../src/modules/journey/useJourneyGuidance',()=>({useJourneyGuidance:()=>mockManual()}));
beforeEach(()=>{jest.clearAllMocks();mockId='41';mockEnabled=true;mockAutomatic=true;});
function render(){let view!:ReactTestRenderer;act(()=>{view=TestRenderer.create(<JourneyGuidanceScreen/>);});return view;}
test.each(['41',['41']].map(id=>[id]))('legacy deep link %p opens owned route detail without manual start or tracking',id=>{
    mockId=id;const view=render();
    expect(view.root.findByType('Redirect' as never).props.href).toEqual({pathname:'/schedule/[id]',params:{id:'41',openRouteDetail:'1'}});
    expect(mockManual).not.toHaveBeenCalled();
    for(const testID of ['journey-start','journey-advance','journey-stop'])expect(view.root.findAllByProps({testID})).toHaveLength(0);
    act(()=>view.unmount());
});
test.each([undefined,'','0','-1','01','41/../42','9007199254740992',[],['41','42']].map(id=>[id]))('invalid identity %p never loads a manual or automatic session',id=>{
    mockId=id;const view=render();expect(view.root.findAllByType('Redirect' as never)).toHaveLength(0);
    expect(view.root.findByProps({testID:'journey-entry-unavailable'}).props.children).toContain('일정에서');
    expect(mockManual).not.toHaveBeenCalled();act(()=>view.unmount());
});
test.each(['feature','automatic'])('disabled %s has no manual fallback or session side effects',gate=>{
    if(gate==='feature')mockEnabled=false;else mockAutomatic=false;
    const view=render();expect(view.root.findAllByType('Redirect' as never)).toHaveLength(0);
    expect(JSON.stringify(view.toJSON())).toContain('탑승·하차를 버튼으로 진행하지 않습니다');
    expect(mockManual).not.toHaveBeenCalled();
    act(()=>view.root.findByProps({accessibilityLabel:'이전 화면으로 돌아가기'}).props.onPress());
    expect(mockReplace).toHaveBeenCalledWith('/schedule');act(()=>view.unmount());
});
