import React from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { ScheduleItem } from "../../types";
import ScheduleItemCard from "./ScheduleItemCard";

type Props = {
    items: ScheduleItem[];
};

function ItemSeparator() {
    return <View style={styles.separator} />;
}

// 일정 배열을 상세 이동이 가능한 카드 리스트로 표시한다.
export default function ScheduleItemList({ items }: Props) {
    const router = useRouter();

    // 일정 카드 선택 시 상세 화면으로 이동한다.
    const goDetail = (id: string) => {
        router.push(`/schedule/${id}`);
    };

    return (
        <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            ItemSeparatorComponent={ItemSeparator}
            renderItem={({ item }) => (
                <ScheduleItemCard item={item} onPress={() => goDetail(item.id)} />
            )}
        />
    );
}

const styles = StyleSheet.create({
    separator: {
        height: 10,
    },
});
