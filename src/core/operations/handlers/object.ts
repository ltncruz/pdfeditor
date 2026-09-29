import type { DocumentState } from '../../document/state';
import type { Operation } from '../types';
import { OperationError } from '../errors';
import type { Applied } from './page';

type Op<T extends Operation['type']> = Extract<Operation, { type: T }>;

export function addObject(state: DocumentState, op: Op<'object/add'>): Applied {
  const page = state.pages[op.pageId];
  if (!page) throw new OperationError('PAGE_NOT_FOUND', `Página inexistente: ${op.pageId}`);
  if (page.objects.some((o) => o.id === op.object.id)) {
    throw new OperationError('DUPLICATE_ID', `Objeto já existe na página: ${op.object.id}`);
  }
  const index = op.index ?? page.objects.length;
  if (!Number.isInteger(index) || index < 0 || index > page.objects.length) {
    throw new OperationError('INVALID_INDEX', `Índice de objeto inválido: ${index}`);
  }
  const objects = [...page.objects];
  objects.splice(index, 0, op.object);
  return {
    state: { ...state, pages: { ...state.pages, [op.pageId]: { ...page, objects } } },
    inverse: { type: 'object/remove', pageId: op.pageId, objectId: op.object.id },
  };
}

export function removeObject(state: DocumentState, op: Op<'object/remove'>): Applied {
  const page = state.pages[op.pageId];
  if (!page) throw new OperationError('PAGE_NOT_FOUND', `Página inexistente: ${op.pageId}`);
  const index = page.objects.findIndex((o) => o.id === op.objectId);
  const object = page.objects[index];
  if (index < 0 || !object) {
    throw new OperationError('OBJECT_NOT_FOUND', `Objeto inexistente: ${op.objectId}`);
  }
  const objects = page.objects.filter((_, i) => i !== index);
  return {
    state: { ...state, pages: { ...state.pages, [op.pageId]: { ...page, objects } } },
    inverse: { type: 'object/add', pageId: op.pageId, object, index },
  };
}
