; PoH Miner Network - Windows Installer
; Built with NSIS (Nullsoft Scriptable Install System)
;
; To build:
;   makensis poh-miner.nsi
;
; Requirements:
;   - NSIS 3.x installed
;   - The Windows binary (poh-miner.exe) must exist in the same directory or be specified

!define APPNAME "PoH Miner"
!define COMPANYNAME "PoH Network"
!define DESCRIPTION "Run the decentralized AI identity compute network and earn POH"
!define VERSIONMAJOR 0
!define VERSIONMINOR 1
!define VERSIONPATCH 0
!define HELPURL "https://github.com/poh/poh-miner-network"
!define UPDATEURL "https://github.com/poh/poh-miner-network/releases"
!define ABOUTURL "https://proofofhuman.ge"

!define INSTALLSIZE 15000 ; approximate in KB

RequestExecutionLevel admin

InstallDir "$PROGRAMFILES64\${APPNAME}"
Name "${APPNAME}"
OutFile "poh-miner-setup.exe"
Icon "poh-miner.ico" ; optional

!include "MUI2.nsh"

!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"

  SetOutPath $INSTDIR

  ; Main binary (you must place poh-miner.exe next to this .nsi when building)
  File "poh-miner.exe"

  ; Create Start Menu shortcut
  CreateDirectory "$SMPROGRAMS\${APPNAME}"
  CreateShortcut "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk" "$INSTDIR\poh-miner.exe" "" "$INSTDIR\poh-miner.exe" 0

  ; Optional: Add to PATH (uncomment if desired)
  ; WriteRegExpandStr HKLM "SYSTEM\CurrentControlSet\Control\Session Manager\Environment" "Path" "$INSTDIR;$Path"

  ; Write uninstaller
  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Add to Add/Remove Programs
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayName" "${APPNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayIcon" "$INSTDIR\poh-miner.exe"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "Publisher" "${COMPANYNAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "HelpLink" "${HELPURL}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "URLUpdateInfo" "${UPDATEURL}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "DisplayVersion" "${VERSIONMAJOR}.${VERSIONMINOR}.${VERSIONPATCH}"
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoModify" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "NoRepair" 1
  WriteRegDWORD HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}" "EstimatedSize" ${INSTALLSIZE}

SectionEnd

Section "Uninstall"

  Delete "$INSTDIR\poh-miner.exe"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APPNAME}\${APPNAME}.lnk"
  RMDir "$SMPROGRAMS\${APPNAME}"

  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPNAME}"

SectionEnd

Function .onInit
  ; Optional: Check if Ollama is installed and warn user
FunctionEnd