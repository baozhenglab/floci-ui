import {Cloud} from 'lucide-react'
import {Navigate, useNavigate, useParams} from 'react-router-dom'
import {
    ProviderBanner,
    RuntimeFlow,
    ServiceGrid,
    SummarySection,
} from '@/features/cloud-console/CloudConsoleSections'
import {useCloudConsoleHomeData} from '@/features/cloud-console/useCloudConsoleHomeData'
import type {CloudProvider} from '@/types/cloud'

export function CloudConsoleHomePage() {
    const navigate = useNavigate()
    const params = useParams()
    const routeCloud = normalizeCloud(params.cloud)
    const cloud = routeCloud ?? 'aws'
    const data = useCloudConsoleHomeData(cloud)

    if (!routeCloud) return <Navigate to="/console/aws" replace/>

    return (
        <>
            <div className="page-header cloud-explorer-header">
                <div className="page-title">
                    <Cloud size={20}/>
                    <div>
                        <h2>Console Home</h2>
                        <p className="muted">Cloud-aware local runtime overview</p>
                    </div>
                </div>
            </div>

            <div className="content cloud-console-home">
                <ProviderBanner
                    runtimeClass={data.runtimeClass}
                    runtimeReachable={data.status?.runtime === 'reachable'}
                    onOpenStorage={() => navigate(`/cloud-explorer/${cloud}/storage`)}
                />

                <SummarySection
                    cloud={cloud}
                    runtimeLabel={data.runtimeLabel}
                    runtimeState={data.runtimeState}
                    runtimeClass={data.runtimeClass}
                    runtimeDetail={data.runtimeDetail}
                    activeServices={data.activeServices}
                    activeServicesDetail={data.activeServicesDetail}
                    resourceCount={data.resourceCount}
                    resourceDetail={data.resourceDetail}
                />

                <RuntimeFlow cloud={cloud} status={data.status}/>

                <ServiceGrid
                    services={data.serviceCards}
                    runtimeReachable={data.status?.runtime === 'reachable'}
                    onNavigate={(route) => navigate(route)}
                />
            </div>
        </>
    )
}

function normalizeCloud(value?: string): CloudProvider | null {
    return value === 'aws' ? value : null
}
