import React from "react";
import { FlatList, View } from "react-native";
import { useRouter } from "expo-router";
import type { ScheduleItem } from "../../../../src/modules/schedule/types";
import ScheduleItemCard from "./ScheduleItemCard";

type Props = {
    items: ScheduleItem[];
};

export default function ScheduleItemList({ items }: Props) {
    const router = useRouter();

    const goDetail = (id: string) => {
        router.push(`/schedule/${id}`);
    };

    return (
        <FlatList
            data={items}
            keyExtractor={(i) => i.id}
            ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
            renderItem={({ item }) => (
                <ScheduleItemCard item={item} onPress={() => goDetail(item.id)} />
            )}
        />
    );
}