import React from "react";

import type { ViewModeDropdownProps } from "./types";

export default function ViewModeDropdown({ fallback = null }: ViewModeDropdownProps) {
    return <>{fallback}</>;
}
