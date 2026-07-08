import { useState } from "react";

import { useODataCollectionStore } from "@ryuzaki13/react-foundation-lib/odata";

import { ODataCollectionModel } from "./types";

export function useODataCollectionModel(model: ODataCollectionModel): Required<ODataCollectionModel> {
	// NOTE: без подписки, потому что эти данные в рантайме не предполагается изменять в ближайшее время.

	// const defaultMaxVisibleItems = odataCollectionConfig.useMaxVisibleItems();
	// const defaultMinSearchCodeLength = odataCollectionConfig.useMinSearchCodeLength();
	// const defaultMinSearchTextLength = odataCollectionConfig.useMinSearchTextLength();
	// const defaultSearchDebounceDelay = odataCollectionConfig.useSearchDebounce();

	const [stableModel] = useState(() => {
		const defaultState = useODataCollectionStore.getState();

		const {
			codeKey,
			maxVisibleItems = defaultState.defaultMaxVisibleItems,
			minSearchCodeLength = defaultState.defaultMinSearchCodeLength,
			minSearchTextLength = defaultState.defaultMinSearchTextLength,
			searchDebounceDelay = defaultState.defaultSearchDebounceDelay
		} = model;
		return {
			codeKey,
			maxVisibleItems,
			minSearchCodeLength,
			minSearchTextLength,
			searchDebounceDelay
		};
	});

	return stableModel;
}
