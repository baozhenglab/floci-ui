import type {CloudProvider, CloudServiceType} from './cloud'

export interface CloudResource {
    id: string
    name: string
    cloud: CloudProvider
    service: CloudServiceType
    type: 'bucket' | 'cluster' | 'db-instance' | 'dynamodb-table' | 'instance' | 'image' | 'vpc' | 'lambda' | 'rest-api'
    region: string | null
    createdAt: string | null
    status?: string | null
    version?: string | null
    engine?: string | null
    instanceClass?: string | null
    metadata: Record<string, unknown>
}

export interface StorageObject {
    key: string
    name: string
    type: 'folder' | 'object'
    size: number | null
    lastModified: string | null
    metadata: Record<string, unknown>
}

export interface StorageObjectList {
    prefix: string
    objects: StorageObject[]
}

export interface NoSqlItem {
    id: string
    key: Record<string, unknown>
    document: Record<string, unknown>
}
