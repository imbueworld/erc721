import {
  ConnectWallet,
  detectContractFeature,
  useActiveClaimConditionForWallet,
  useAddress,
  useClaimConditions,
  useClaimedNFTSupply,
  useClaimerProofs,
  useClaimIneligibilityReasons,
  useContract,
  useContractMetadata,
  useNFT,
  useUnclaimedNFTSupply,
  Web3Button,
} from "@thirdweb-dev/react";
import { BigNumber, utils } from "ethers";
import { useMemo, useState } from "react";
import { HeadingImage } from "./components/HeadingImage";
import { useToast } from "./components/ui/use-toast";
import { parseIneligibility } from "./utils/parseIneligibility";
import {
  clientIdConst,
  contractConst,
  // secondContractConst,
  primaryColorConst,
  themeConst,
} from "./consts/parameters";
import { ContractWrapper } from "@thirdweb-dev/sdk/dist/declarations/src/evm/core/classes/contract-wrapper";
import { useForm } from "react-hook-form";
import { getDatabase, ref, push } from "firebase/database";
import { getApps, initializeApp } from 'firebase/app';
import localImage from './nftmain.png'; // replace with the actual path to your image file


const urlParams = new URL(window.location.toString()).searchParams;
const contractAddress = urlParams.get("contract") || contractConst || "";
const primaryColor =
  urlParams.get("primaryColor") || primaryColorConst || undefined;

const colors = {
  purple: "#7C3AED",
  blue: "#3B82F6",
  orange: "#F59E0B",
  pink: "#EC4899",
  green: "#10B981",
  red: "#EF4444",
  teal: "#14B8A6",
  cyan: "#22D3EE",
  yellow: "#FBBF24",
} as const;

export default function Home() {
  const contractQuery = useContract(contractAddress);
  const contractMetadata = useContractMetadata(contractQuery.contract);
  const { toast } = useToast();
  let theme = (urlParams.get("theme") || themeConst || "light") as
    | "light"
    | "dark"
    | "system";
  if (theme === "system") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  const root = window.document.documentElement;
  root.classList.add(theme);
  const address = useAddress();
  const [quantity, setQuantity] = useState(1);
  const claimConditions = useClaimConditions(contractQuery.contract);
  const activeClaimCondition = useActiveClaimConditionForWallet(
    contractQuery.contract,
    address,
  );
  const claimerProofs = useClaimerProofs(contractQuery.contract, address || "");
  const claimIneligibilityReasons = useClaimIneligibilityReasons(
    contractQuery.contract,
    {
      quantity,
      walletAddress: address || "",
    },
  );
  const unclaimedSupply = useUnclaimedNFTSupply(contractQuery.contract);
  const claimedSupply = useClaimedNFTSupply(contractQuery.contract);
  const { data: firstNft, isLoading: firstNftLoading } = useNFT(
    contractQuery.contract,
    0,
  );

  const numberClaimed = useMemo(() => {
    return BigNumber.from(claimedSupply.data || 0).toString();
  }, [claimedSupply]);

  const numberTotal = useMemo(() => {
    return BigNumber.from(claimedSupply.data || 0)
      .add(BigNumber.from(unclaimedSupply.data || 0))
      .toString();
  }, [claimedSupply.data, unclaimedSupply.data]);

  const priceToMint = useMemo(() => {
    const bnPrice = BigNumber.from(
      activeClaimCondition.data?.currencyMetadata.value || 0,
    );
    return `${utils.formatUnits(
      bnPrice.mul(quantity).toString(),
      activeClaimCondition.data?.currencyMetadata.decimals || 18,
    )} ${activeClaimCondition.data?.currencyMetadata.symbol}`;
  }, [
    activeClaimCondition.data?.currencyMetadata.decimals,
    activeClaimCondition.data?.currencyMetadata.symbol,
    activeClaimCondition.data?.currencyMetadata.value,
    quantity,
  ]);

  const isOpenEdition = useMemo(() => {
    if (contractQuery?.contract) {
      const contractWrapper = (contractQuery.contract as any)
        .contractWrapper as ContractWrapper<any>;

      const featureDetected = detectContractFeature(
        contractWrapper,
        "ERC721SharedMetadata",
      );

      return featureDetected;
    }
    return false;
  }, [contractQuery.contract]);

  const maxClaimable = useMemo(() => {
    let bnMaxClaimable;
    try {
      bnMaxClaimable = BigNumber.from(
        activeClaimCondition.data?.maxClaimableSupply || 0,
      );
    } catch (e) {
      bnMaxClaimable = BigNumber.from(1_000_000);
    }

    let perTransactionClaimable;
    try {
      perTransactionClaimable = BigNumber.from(
        activeClaimCondition.data?.maxClaimablePerWallet || 0,
      );
    } catch (e) {
      perTransactionClaimable = BigNumber.from(1_000_000);
    }

    if (perTransactionClaimable.lte(bnMaxClaimable)) {
      bnMaxClaimable = perTransactionClaimable;
    }

    const snapshotClaimable = claimerProofs.data?.maxClaimable;

    if (snapshotClaimable) {
      if (snapshotClaimable === "0") {
        // allowed unlimited for the snapshot
        bnMaxClaimable = BigNumber.from(1_000_000);
      } else {
        try {
          bnMaxClaimable = BigNumber.from(snapshotClaimable);
        } catch (e) {
          // fall back to default case
        }
      }
    }

    const maxAvailable = BigNumber.from(unclaimedSupply.data || 0);

    let max;
    if (maxAvailable.lt(bnMaxClaimable) && !isOpenEdition) {
      max = maxAvailable;
    } else {
      max = bnMaxClaimable;
    }

    if (max.gte(1_000_000)) {
      return 1_000_000;
    }
    return max.toNumber();
  }, [
    claimerProofs.data?.maxClaimable,
    unclaimedSupply.data,
    activeClaimCondition.data?.maxClaimableSupply,
    activeClaimCondition.data?.maxClaimablePerWallet,
  ]);

  const isSoldOut = useMemo(() => {
    try {
      return (
        (activeClaimCondition.isSuccess &&
          BigNumber.from(activeClaimCondition.data?.availableSupply || 0).lte(
            0,
          )) ||
        (numberClaimed === numberTotal && !isOpenEdition)
      );
    } catch (e) {
      return false;
    }
  }, [
    activeClaimCondition.data?.availableSupply,
    activeClaimCondition.isSuccess,
    numberClaimed,
    numberTotal,
    isOpenEdition,
  ]);

  const canClaim = useMemo(() => {
    return (
      activeClaimCondition.isSuccess &&
      claimIneligibilityReasons.isSuccess &&
      claimIneligibilityReasons.data?.length === 0 &&
      !isSoldOut
    );
  }, [
    activeClaimCondition.isSuccess,
    claimIneligibilityReasons.data?.length,
    claimIneligibilityReasons.isSuccess,
    isSoldOut,
  ]);

  const isLoading = useMemo(() => {
    return (
      activeClaimCondition.isLoading ||
      unclaimedSupply.isLoading ||
      claimedSupply.isLoading ||
      !contractQuery.contract
    );
  }, [
    activeClaimCondition.isLoading,
    contractQuery.contract,
    claimedSupply.isLoading,
    unclaimedSupply.isLoading,
  ]);

  const buttonLoading = useMemo(
    () => isLoading || claimIneligibilityReasons.isLoading,
    [claimIneligibilityReasons.isLoading, isLoading],
  );

  const buttonText = useMemo(() => {
    if (isSoldOut) {
      return "Sold Out";
    }

    if (canClaim) {
      const pricePerToken = BigNumber.from(
        activeClaimCondition.data?.currencyMetadata.value || 0,
      );
      if (pricePerToken.eq(0)) {
        return "Mint (Free)";
      }
      return `Mint (${priceToMint})`;
    }
    if (claimIneligibilityReasons.data?.length) {
      return parseIneligibility(claimIneligibilityReasons.data, quantity);
    }
    if (buttonLoading) {
      return "Checking eligibility...";
    }

    return "Minting not available";
  }, [
    isSoldOut,
    canClaim,
    claimIneligibilityReasons.data,
    buttonLoading,
    activeClaimCondition.data?.currencyMetadata.value,
    priceToMint,
    quantity,
  ]);

  const dropNotReady = useMemo(
    () =>
      claimConditions.data?.length === 0 ||
      claimConditions.data?.every((cc) => cc.maxClaimableSupply === "0"),
    [claimConditions.data],
  );

  const dropStartingSoon = useMemo(
    () =>
      (claimConditions.data &&
        claimConditions.data.length > 0 &&
        activeClaimCondition.isError) ||
      (activeClaimCondition.data &&
        activeClaimCondition.data.startTime > new Date()),
    [
      activeClaimCondition.data,
      activeClaimCondition.isError,
      claimConditions.data,
    ],
  );

  const clientId = urlParams.get("clientId") || clientIdConst || "";
  if (!clientId) {
    return (
      <div className="flex items-center justify-center h-full">
        Client ID is required as a query param to use this page.
      </div>
    );
  }

  if (!contractAddress) {
    return (
      <div className="flex items-center justify-center h-full">
        No contract address provided
      </div>
    );
  }
  // Add this inside your Home function
  const { register, handleSubmit, formState: { errors, isValid } } = useForm({ mode: 'onChange', reValidateMode: 'onSubmit' });
  const [isSubmitted, setIsSubmitted] = useState(false);

  if (!getApps().length) {
    initializeApp({
      apiKey: "AIzaSyDV5kyZ1iVrKGO7eKaSdlTPRgxb-8ldo_o",
      authDomain: "greenteadao-dbc3e.firebaseapp.com",
      projectId: "greenteadao-dbc3e",
      storageBucket: "greenteadao-dbc3e.appspot.com",
      messagingSenderId: "163956433340",
      appId: "1:163956433340:web:e88ce8e0014b2c92760bb9",
      measurementId: "G-GXZWTFN3D1"
    });
  }


  const db = getDatabase();

  const onSubmit = (data: any) => {
    console.log("button clicked");
    setIsSubmitted(true);
    if (isValid) {
      console.log(data); // Replace this line with your minting function

      // Save data to Firebase
      push(ref(db, 'formSubmissions'), {
        ...data,
        nftsMinted: quantity, // Add the quantity of NFTs minted
      });
    };
  }

  // Replace contractAddress with secondContractConst
  // const secondContractQuery = useContract(secondContractConst);

  // // Replace contractMetadata with secondContractMetadata
  // const secondContractMetadata = useContractMetadata(secondContractQuery.contract);

  // // Replace contractQuery with secondContractQuery
  // const secondUnclaimedSupply = useUnclaimedNFTSupply(secondContractQuery.contract);
  // const secondClaimedSupply = useClaimedNFTSupply(secondContractQuery.contract);

  // // Replace contractQuery with secondContractQuery
  // const secondClaimConditions = useClaimConditions(secondContractQuery.contract);
  // const secondActiveClaimCondition = useActiveClaimConditionForWallet(
  //   secondContractQuery.contract,
  //   address,
  // );

  // // Replace contractQuery with secondContractQuery
  // const secondClaimerProofs = useClaimerProofs(secondContractQuery.contract, address || "");

  // // Replace contractQuery with secondContractQuery
  // const secondClaimIneligibilityReasons = useClaimIneligibilityReasons(
  //   secondContractQuery.contract,
  //   {
  //     quantity,
  //     walletAddress: address || "",
  //   },
  // );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <ConnectWallet className="!absolute !right-4 !top-4" theme={theme} />
      <div className="grid h-screen grid-cols-1 lg:grid-cols-12">
        <div className="items-center justify-center hidden w-full h-full lg:col-span-5 lg:flex lg:px-12">
          <HeadingImage
            src={localImage || contractMetadata.data?.image || firstNft?.metadata.image || ""}
            isLoading={isLoading}
          />
        </div>
        <div className="flex items-center justify-center w-full h-full col-span-1 lg:col-span-7">
          <div className="flex flex-col w-full max-w-xl gap-4 p-12 rounded-xl lg:border lg:border-gray-400 lg:dark:border-gray-800">
            <div className="flex w-full mt-8 xs:mb-8 xs:mt-0 lg:hidden">
              <HeadingImage
                src={localImage || contractMetadata.data?.image || firstNft?.metadata.image || ""}
                isLoading={isLoading}
              />
            </div>

            <div className="flex flex-col gap-2 xs:gap-4">
              {isLoading ? (
                <div
                  role="status"
                  className="space-y-8 animate-pulse md:flex md:items-center md:space-x-8 md:space-y-0"
                >
                  <div className="w-full">
                    <div className="w-24 h-10 bg-gray-200 rounded-full dark:bg-gray-700"></div>
                  </div>
                </div>
              ) : isOpenEdition ? null : (
                <p>
                  <span className="text-lg font-bold tracking-wider text-gray-500 xs:text-xl lg:text-2xl">
                    {numberClaimed}
                  </span>{" "}
                  <span className="text-lg font-bold tracking-wider xs:text-xl lg:text-2xl">
                    / {numberTotal} minted
                  </span>
                </p>
              )}
              <h1 className="text-2xl font-bold line-clamp-1 xs:text-3xl lg:text-4xl">
                {contractMetadata.isLoading ? (
                  <div
                    role="status"
                    className="space-y-8 animate-pulse md:flex md:items-center md:space-x-8 md:space-y-0"
                  >
                    <div className="w-full">
                      <div className="w-48 h-8 bg-gray-200 rounded-full dark:bg-gray-700"></div>
                    </div>
                    <span className="sr-only">Loading...</span>
                  </div>
                ) : (
                  contractMetadata.data?.name
                )}
              </h1>
              {contractMetadata.data?.description ||
                contractMetadata.isLoading ? (
                <div className="text-gray-500 line-clamp-2">
                  {contractMetadata.isLoading ? (
                    <div
                      role="status"
                      className="space-y-8 animate-pulse md:flex md:items-center md:space-x-8 md:space-y-0"
                    >
                      <div className="w-full">
                        <div className="mb-2.5 h-2 max-w-[480px] rounded-full bg-gray-200 dark:bg-gray-700"></div>
                        <div className="mb-2.5 h-2 rounded-full bg-gray-200 dark:bg-gray-700"></div>
                      </div>
                      <span className="sr-only">Loading...</span>
                    </div>
                  ) : (
                    contractMetadata.data?.description
                  )}
                </div>
              ) : null}
            </div>
            <div className="flex w-full gap-4">
              {dropNotReady ? (
                <div>
                  <div className="w-fullmb-4 text-white">
                    <h2>What you will get from this drop:</h2>
                    <ul className="list-disc list-inside">
                      <li>Tea from all 47 Prefecture of Japan</li>
                      <li>In Custom US Made Wooden Box With Japan Map Engraved</li>
                      <li>Unique NFT of the map of Japan</li>
                      <li>A matcha kit</li>
                      <li>Early Access to future drops</li>
                      <li>Exclusive 1st NFT Drop Chat</li>
                    </ul>
                  </div>
                  <span className="text-red-500">
                    This drop is not ready to be minted yet. (No claim condition
                    set)
                  </span>
                </div>

              ) : dropStartingSoon ? (
                <div>
                  <div className="w-fullmb-4 text-white">
                    <h2>What you will get from this drop:</h2>
                    <ul className="list-disc list-inside">
                      <li>Tea from all 47 Prefecture of Japan</li>
                      <li>In Custom US Made Wooden Box With Japan Map Engraved</li>
                      <li>Unique NFT of the map of Japan</li>
                      <li>A matcha kit</li>
                      <li>Early Access to future drops</li>
                    </ul>
                  </div>
                  <span className="text-gray-500">
                    Drop is starting soon. Please check back later.
                  </span>
                </div>
              ) : (
                <div className="flex flex-col w-full gap-4">
                  <div className="w-fullmb-4 text-white">
                    <h2>What you will get:</h2>
                    <ul className="list-disc list-inside">
                      <li>Tea from all 47 Prefecture of Japan</li>
                      <li>In Custom USA Made Wooden Box With Japan Map Engraved</li>
                      <li>A ceremonial grade matcha kit + traditional japanese chasen</li>
                      <li>Unique NFT of the map of Japan (with NFT purchase)</li>
                      <li>Early Access to future products (with NFT purchase)</li>
                    </ul>
                  </div>
                  
                  <hr className="my-4" /> 
{/* 
                  <div className="flex justify-center">
                    <a href="https://buy.stripe.com/4gw8xBe0S2Q6b5u6oo" target="_blank" rel="noopener noreferrer">
                      <button className="px-4 py-2 text-white bg-blue-500 rounded hover:bg-blue-700">
                        Purchase with Credit Card
                      </button>
                    </a>
                  </div> */}
                  <hr className="my-4" /> 
                  <p className="text-center text-gray-400">or</p>
                  {(!canClaim || buttonLoading || !isValid) && (
                    <p className="text-sm text-gray-400">Please fill out the form before minting. Address is needed to ship the custom wooden box and tea.</p>
                  )}
                  <div className="flex flex-col w-full gap-4 lg:flex-row lg:items-center lg:gap-4 ">
                    <div className="flex w-full px-2 border border-gray-400 rounded-lg h-11 dark:border-gray-800 md:w-full">
                      <button
                        onClick={() => {
                          const value = quantity - 1;
                          if (value > maxClaimable) {
                            setQuantity(maxClaimable);
                          } else if (value < 1) {
                            setQuantity(1);
                          } else {
                            setQuantity(value);
                          }
                        }}
                        className="flex items-center justify-center h-full px-2 text-2xl text-center rounded-l-md disabled:cursor-not-allowed disabled:text-gray-500 dark:text-white dark:disabled:text-gray-600"
                        disabled={isSoldOut || quantity - 1 < 1}
                      >
                        -
                      </button>
                      <p className="flex items-center justify-center w-full h-full font-mono text-center dark:text-white lg:w-full">
                        {!isLoading && isSoldOut ? "Sold Out" : quantity}
                      </p>
                      <button
                        onClick={() => {
                          const value = quantity + 1;
                          if (value > maxClaimable) {
                            setQuantity(maxClaimable);
                          } else if (value < 1) {
                            setQuantity(1);
                          } else {
                            setQuantity(value);
                          }
                        }}
                        className={
                          "flex h-full items-center justify-center rounded-r-md px-2 text-center text-2xl disabled:cursor-not-allowed disabled:text-gray-500 dark:text-white dark:disabled:text-gray-600"
                        }
                        disabled={isSoldOut || quantity + 1 > maxClaimable}
                      >
                        +
                      </button>
                    </div>
                    <form onSubmit={handleSubmit(onSubmit)}>
                      <input {...register("name", { required: true })} placeholder="Name" className={`mb-4 p-2 rounded-lg border-2 ${errors.name ? 'border-red-500' : 'bg-gray-800'} outline-none`} />

                      <input {...register("address", { required: true })} placeholder="Shipping Address" className={`mb-4 p-2 rounded-lg border-2 ${errors.address ? 'border-red-500' : 'bg-gray-800'} outline-none`} />

                      <input {...register("email", { required: true, pattern: /^[^@ ]+@[^@ ]+\.[^@ .]{2,}$/ })} placeholder="Email" className={`mb-4 p-2 rounded-lg border-2 ${errors.email ? 'border-red-500' : 'bg-gray-800'} outline-none`} />

                      <Web3Button
                        contractAddress={
                          contractQuery.contract?.getAddress() || ""
                        }
                        style={{
                          backgroundColor:
                            colors[primaryColor as keyof typeof colors] ||
                            primaryColor,
                          maxHeight: "43px",
                        }}
                        theme={theme}
                        action={(cntr) => cntr.erc721.claim(quantity)}
                        isDisabled={!canClaim || buttonLoading}
                        onError={(err) => {
                          console.error(err);
                          console.log({ err });
                          toast({
                            title: "Failed to mint drop",
                            description: (err as any).reason || "",
                            duration: 9000,
                            variant: "destructive",
                          });
                        }}
                        onSuccess={() => {
                          toast({
                            title: "Successfully minted",
                            description:
                              "The NFT has been transferred to your wallet",
                            duration: 5000,
                            className: "bg-green-500",
                          });
                        }}
                      >
                        {buttonLoading ? (
                          <div role="status">
                            <svg
                              aria-hidden="true"
                              className="w-4 h-4 mr-2 text-gray-200 animate-spin fill-blue-600 dark:text-gray-600"
                              viewBox="0 0 100 101"
                              fill="none"
                              xmlns="http://www.w3.org/2000/svg"
                            >
                              <path
                                d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z"
                                fill="currentColor"
                              />
                              <path
                                d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z"
                                fill="currentFill"
                              />
                            </svg>
                            <span className="sr-only">Loading...</span>
                          </div>
                        ) : (
                          buttonText
                        )}
                      </Web3Button>
                    </form>
                  </div>
                  {isSubmitted && !isValid && <span className="text-center text-red-500">Please fill out the form correctly before minting.</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
