import * as pulumi from "@pulumi/pulumi";
import * as resources from "@pulumi/azure-native/resources";
import * as storage from "@pulumi/azure-native/storage";
import * as web from "@pulumi/azure-native/web";
import * as containerregestry from "@pulumi/azure-native/containerregistry";
import * as docker from "@pulumi/docker"

const resourceGroup = new resources.ResourceGroup("app")

const storageAccount = new storage.StorageAccount("app", {
    enableHttpsTrafficOnly: true,
    kind: storage.Kind.StorageV2,
    resourceGroupName: resourceGroup.name,
    sku: {
        name: storage.SkuName.Standard_LRS
    }
})

const staticWebsite = new storage.StorageAccountStaticWebsite("app", {
    accountName: storageAccount.name,
    resourceGroupName: resourceGroup.name,
    indexDocument: "index.html",
    error404Document: "404.html",
});

["index.html", "404.html"].map(
    (name) =>
        new storage.Blob(name, {
            resourceGroupName: resourceGroup.name,
            accountName: storageAccount.name,
            containerName: staticWebsite.containerName,
            source: new pulumi.asset.FileAsset(`../wwwroot/${name}`),
            contentType: "text/html"
        })
)

export const url = storageAccount.primaryEndpoints.web

// docker image

const plan = new web.AppServicePlan("app", {
    resourceGroupName: resourceGroup.name,
    kind: "Linux",
    reserved: true,
    sku: {
        name: "B1",
        tier: "Basic"
    },
})

const registry = new containerregestry.Registry("app", {
    resourceGroupName: resourceGroup.name,
    sku: {
        name: "Basic"
    },
    adminUserEnabled: true,
})

const credentials = pulumi.all([resourceGroup.name, registry.name]).apply(
    ([ResourceGroupName, registryName]) => containerregestry.listRegistryCredentials({
        resourceGroupName: ResourceGroupName,
        registryName: registryName
    })
)

const adminUsername = credentials.apply(credentials => credentials.username!)
const adminPassword = credentials.apply(credentials => credentials.passwords![0].value!)

const image = new docker.Image("app", {
    imageName: pulumi.interpolate`${registry.loginServer}/app:latest`,
    build: { context: "../wwwroot" },
    registry: {
        server: registry.loginServer,
        username: adminUsername,
        password: adminPassword,
    },
})

const app = new web.WebApp("app", {
    resourceGroupName: resourceGroup.name,
    serverFarmId: plan.id,
    siteConfig: {
        appSettings: [
            {
                name: "DOKER_REGISTRY_SERVER_URL",
                value: pulumi.interpolate`https://${registry.loginServer}`,
            },
            {
                name: "DOKER_REGISTRY_SERVER_USERNAME",
                value: adminUsername,
            },
            {
                name: "DOKER_REGISTRY_SERVER_PASSWORD",
                value: adminPassword,
            },
            {
                name: "WEBSITES_PORT",
                value: "80",
            },
        ],
        alwaysOn: true,
        linuxFxVersion: pulumi.interpolate`DOCKER|${image.imageName}`,
    },
    httpsOnly: true,
});

export const webAppUrl = pulumi.interpolate`https://${app.defaultHostName}`
