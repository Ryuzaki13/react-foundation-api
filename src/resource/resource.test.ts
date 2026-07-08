import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
	applyResourceCacheStrategy,
	createResourceDescriptor,
	createResourceQueryOperation,
	createSetResourceQueryDataCacheStrategy,
	getResourceQueryData
} from "./index";

describe("resource api", () => {
	it("поддерживает произвольные read operation names и стабильные query keys", async () => {
		type Scope = {
			readonly userId: string;
		};

		const execute = vi.fn(async ({ scope, args }: { readonly scope: Scope; readonly args: { readonly limit: number } }) => [
			`${scope.userId}:${args.limit}`
		]);
		const descriptor = createResourceDescriptor({
			namespace: "demo",
			resource: "dashboard",
			normalizeScope: (scope: Scope | null | undefined) => ({ userId: scope?.userId.trim() ?? "" }),
			operations: {
				queries: {
					snapshot: createResourceQueryOperation<Scope, { readonly limit: number }, readonly string[]>({
						execute
					})
				}
			}
		});
		const client = new QueryClient();

		const result = await getResourceQueryData(descriptor, "snapshot", { userId: " USER " }, { limit: 3 }, client);

		expect(result).toEqual([" USER :3"]);
		expect(descriptor.keys.operation("snapshot", { userId: " USER " }, { limit: 3 })).toEqual([
			"demo",
			"dashboard",
			{ userId: "USER" },
			"snapshot",
			{ limit: 3 }
		]);
		expect(execute).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: { userId: " USER " },
				args: { limit: 3 },
				client
			})
		);
	});

	it("применяет generic cache strategy без persisted capability model", async () => {
		type Scope = {
			readonly id: string;
		};

		const client = new QueryClient();
		const descriptor = createResourceDescriptor({
			namespace: "demo",
			resource: "settings",
			operations: {
				queries: {
					detail: createResourceQueryOperation<Scope, void, { readonly count: number }>({
						execute: async () => ({ count: 0 })
					})
				}
			}
		});
		client.setQueryData(descriptor.keys.operation("detail", { id: "scope" }), { count: 1 });

		await applyResourceCacheStrategy(
			createSetResourceQueryDataCacheStrategy<Scope, void, { readonly value: number }, { readonly count: number }, typeof descriptor>(
				{
					getQueryKey: ({ descriptor: currentDescriptor, scope }) => currentDescriptor.keys.operation("detail", scope),
					update: (_, { result }) => ({ count: result.value })
				}
			),
			{
				client,
				descriptor,
				scope: { id: "scope" },
				input: undefined,
				result: { value: 5 }
			}
		);

		expect(client.getQueryData(descriptor.keys.operation("detail", { id: "scope" }))).toEqual({ count: 5 });
	});
});
