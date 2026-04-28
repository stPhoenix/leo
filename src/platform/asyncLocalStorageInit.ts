import { AsyncLocalStorage } from 'async_hooks';
import { AsyncLocalStorageProviderSingleton } from '@langchain/core/singletons';

AsyncLocalStorageProviderSingleton.initializeGlobalInstance(new AsyncLocalStorage());
