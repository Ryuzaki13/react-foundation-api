import { useODataCollectionQuery } from "./useODataCollectionQuery";

import type { CollectionItem } from "@ryuzaki13/react-foundation-lib/odata";

export function useTextServiceQuery<T extends CollectionItem>(target: string) {
	return useODataCollectionQuery<T>({ service: "TEXT_DICTIONARY_SRV", target });
}
